// Checkpoint-side P2P listener. The checkpoint is the only peer that runs Qwen.

import net from 'node:net'
import Hyperswarm from 'hyperswarm'
import { TOPIC } from './topic.js'
import { attachReportReceiver } from './receive-report.js'
import {
  startCheckpointBeacon,
  getLocalIPv4,
  DEFAULT_TCP_PORT,
  DEFAULT_DHT_PORT
} from './beacon.js'
import { loadAlerts } from '../checkpoint/alert-store.js'
import {
  markIncomingTranscript,
  saveIncomingTranscript
} from '../checkpoint/incoming-transcript-store.js'
import { storeTranscript } from '../ai/store-alert.js'

async function processTranscriptWithQwen (report) {
  console.log(`[checkpoint] Sending transcript ${report.id} to Qwen`)
  try {
    const alert = await storeTranscript(report.rawTranscript, {
      id: report.id,
      createdAt: report.createdAt,
      onProgress: (progress) => {
        process.stdout.write(`\r[checkpoint] Qwen: ${progress.percentage.toFixed(0)}%`)
      }
    })
    await markIncomingTranscript(report.id, 'processed')
    console.log(`\n[checkpoint] Stored alert ${alert.id}`)
  } catch (error) {
    await markIncomingTranscript(report.id, 'rejected', error.message)
    console.error(`\n[checkpoint] Qwen failed for ${report.id}: ${error.message}`)
  }
}

async function processIncomingReport (report) {
  console.log(`[checkpoint] Received transcript ${report.id}: "${report.rawTranscript}"`)
  await saveIncomingTranscript(report)
  console.log(`[checkpoint] Persisted transcript ${report.id}`)
  void processTranscriptWithQwen(report)
  return { id: report.id, processing: 'queued' }
}

function receiverOptions () {
  return {
    onReport: processIncomingReport,
    onGetReports: loadAlerts
  }
}

export async function startCheckpoint (options = {}) {
  const host = options.host || getLocalIPv4()
  const tcpPort = options.tcpPort || DEFAULT_TCP_PORT
  const dhtPort = options.dhtPort || DEFAULT_DHT_PORT
  const tcpServer = net.createServer((socket) => {
    console.log('[checkpoint] Hiker connected:', socket.remoteAddress || 'unknown')
    attachReportReceiver(socket, receiverOptions())
  })

  await new Promise((resolve, reject) => {
    tcpServer.once('error', reject)
    tcpServer.listen(tcpPort, '0.0.0.0', resolve)
  })

  let beacon = null
  try {
    beacon = await startCheckpointBeacon({ host, tcpPort, dhtPort })
  } catch (error) {
    console.error('[checkpoint] Beacon unavailable:', error.message)
  }

  const swarm = new Hyperswarm()
  swarm.on('connection', (socket) => {
    console.log('[checkpoint] Hiker connected through swarm')
    attachReportReceiver(socket, receiverOptions())
  })
  swarm.on('error', (error) => console.error('[checkpoint] Swarm notice:', error.message))
  const discovery = swarm.join(TOPIC, { server: true, client: false })
  discovery.flushed().catch(() => {})

  console.log(`[checkpoint] READY at ${host}:${tcpPort}`)
  console.log(`[checkpoint] Stored alerts: ${(await loadAlerts()).length}`)

  let shutdownPromise
  return {
    tcpServer,
    swarm,
    async destroy () {
      if (shutdownPromise) return shutdownPromise
      shutdownPromise = (async () => {
        await new Promise(resolve => tcpServer.close(resolve))
        if (beacon) await beacon.destroy()
        await swarm.destroy()
      })()
      return shutdownPromise
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const checkpoint = await startCheckpoint()
  const shutdown = async () => {
    await checkpoint.destroy()
    process.exit(0)
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}
