// src/p2p/checkpoint.js
// Checkpoint-side P2P listener, offline TCP transport, QVAC alert formatting, and report store.

import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Hyperswarm from 'hyperswarm'

import { TOPIC } from './topic.js'
import { attachReportReceiver } from './receive-report.js'
import { createReportStore } from './report-store.js'
import {
  startCheckpointBeacon,
  getLocalIPv4,
  DEFAULT_TCP_PORT,
  DEFAULT_DHT_PORT
} from './beacon.js'
import { formatAlert, closeModel } from '../ai/extract-report.js'
import { loadAlerts, saveAlert } from '../checkpoint/alert-store.js'

const DEFAULT_STORE_PATH = path.resolve('data/checkpoint-alerts.json')

export async function startCheckpoint(options = {}) {
  const filePath = options.filePath || DEFAULT_STORE_PATH
  const host = options.host || getLocalIPv4()
  const tcpPort = options.tcpPort || DEFAULT_TCP_PORT
  const dhtPort = options.dhtPort || DEFAULT_DHT_PORT

  // Load persistent reports before accepting new connections.
  const store = await createReportStore(filePath)

  // Process incoming report: format via QVAC local LLM (with instant fallback)
  async function handleIncomingReport(rawReport) {
    let formattedFields = {}
    const textToFormat = rawReport.rawTranscript || rawReport.description || rawReport.originalText || ''

    try {
      console.log(`[checkpoint] Formatting report ${rawReport.id} with local QVAC LLM...`)
      formattedFields = await formatAlert(textToFormat)
      console.log(`[checkpoint] QVAC formatted: ${formattedFields.category} | ${formattedFields.trailSegment}`)
    } catch (err) {
      console.warn(`[checkpoint] QVAC format fallback used: ${err.message}`)
    }

    const createdAt = rawReport.createdAt || new Date().toISOString()
    const alert = {
      id: rawReport.id,
      createdAt,
      date: createdAt.slice(0, 10),
      time: createdAt.slice(11, 19),
      category: formattedFields.category || rawReport.category || 'general',
      title: rawReport.title || formattedFields.category || 'Trail Alert',
      description: formattedFields.description || rawReport.description || textToFormat,
      trailSegment: formattedFields.trailSegment || rawReport.trailSegment || 'unknown',
      status: 'unverified',
      source: rawReport.source || 'hiker-device',
      rawTranscript: textToFormat,
      originalText: textToFormat
    }

    const result = await store.saveReport(alert)
    if (result.duplicate) {
      console.log('[checkpoint] Duplicate report:', alert.id)
    } else {
      console.log('[checkpoint] Report saved and verified:', alert.id)
    }

    // Also mirror to checkpoint-alerts.json if separate
    try {
      if (path.resolve(filePath) !== path.resolve('data/checkpoint-alerts.json')) {
        await saveAlert(alert).catch(() => {})
      }
    } catch {}

    return result
  }

  // 1. Direct offline TCP listener (instant local-hotspot connection)
  const tcpServer = net.createServer((socket) => {
    const peerAddress = socket.remoteAddress || 'unknown'
    console.log('[checkpoint] Hiker connected (direct offline):', peerAddress)

    socket.on('close', () => {
      console.log('[checkpoint] Hiker disconnected (direct offline):', peerAddress)
    })

    attachReportReceiver(socket, {
      onReport: handleIncomingReport,
      onGetReports: async () => store.getReports()
    })
  })

  await new Promise((resolve) => {
    tcpServer.listen(tcpPort, '0.0.0.0', () => {
      console.log(`[checkpoint] Direct offline TCP transport active on port ${tcpPort}`)
      resolve()
    })
  })

  // 2. Start UDP discovery beacon for zero-config offline discovery by hikers
  let beacon = null
  try {
    beacon = await startCheckpointBeacon({ host, tcpPort, dhtPort })
  } catch (err) {
    console.log('[checkpoint] UDP beacon notice:', err.message)
  }

  // 3. Hyperswarm swarm (for topic discovery when online)
  const swarm = new Hyperswarm()
  let shutdownPromise = null

  swarm.on('connection', (socket, peerInfo) => {
    const peerKey = peerInfo?.publicKey
      ? peerInfo.publicKey.toString('hex')
      : 'unknown'

    console.log('[checkpoint] Hiker connected (swarm):', peerKey)

    socket.on('close', () => {
      console.log('[checkpoint] Hiker disconnected (swarm):', peerKey)
    })

    attachReportReceiver(socket, {
      onReport: handleIncomingReport,
      onGetReports: async () => store.getReports()
    })
  })

  swarm.on('error', (error) => {
    console.error('[checkpoint] Swarm notice:', error.message)
  })

  console.log('[checkpoint] Joining shared topic...')
  const discovery = swarm.join(TOPIC, {
    server: true,
    client: false
  })

  discovery.flushed().catch(() => {})

  const existingReports = await store.getReports()

  console.log('[checkpoint] READY')
  console.log('[checkpoint] Local IP:', host)
  console.log('[checkpoint] Stored reports:', existingReports.length)
  console.log('[checkpoint] Waiting for hikers...')

  async function destroy() {
    if (!shutdownPromise) {
      shutdownPromise = (async () => {
        console.log('[checkpoint] Shutting down...')
        await new Promise((res) => tcpServer.close(res))
        if (beacon) await beacon.destroy()
        await swarm.destroy().catch(() => {})
        await closeModel().catch(() => {})
        console.log('[checkpoint] Stopped.')
      })()
    }

    return shutdownPromise
  }

  return {
    swarm,
    tcpServer,
    store,
    destroy
  }
}

// Run directly with: node src/p2p/checkpoint.js
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isMain) {
  startCheckpoint()
    .then((checkpoint) => {
      const shutdown = async () => {
        await checkpoint.destroy()
        process.exitCode = 0
      }

      process.once('SIGINT', shutdown)
      process.once('SIGTERM', shutdown)
    })
    .catch((error) => {
      console.error('[checkpoint] Startup failed:', error)
      process.exitCode = 1
    })
}
