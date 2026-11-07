// src/p2p/checkpoint.js
// Checkpoint-side P2P listener, offline TCP transport, and report store.

'use strict'

const net = require('node:net')
const path = require('node:path')
const Hyperswarm = require('hyperswarm')

const { TOPIC } = require('./topic')
const { attachReportReceiver } = require('./receive-report')
const { createReportStore } = require('./report-store')
const {
  startCheckpointBeacon,
  getLocalIPv4,
  DEFAULT_TCP_PORT,
  DEFAULT_DHT_PORT
} = require('./beacon')

const DEFAULT_STORE_PATH = path.resolve(
  __dirname,
  '../../data/reports.json'
)

async function startCheckpoint(options = {}) {
  const filePath = options.filePath || DEFAULT_STORE_PATH
  const host = options.host || getLocalIPv4()
  const tcpPort = options.tcpPort || DEFAULT_TCP_PORT
  const dhtPort = options.dhtPort || DEFAULT_DHT_PORT

  // Load persistent reports before accepting new connections.
  const store = await createReportStore(filePath)

  // 1. Direct offline TCP listener (instant 100% reliable local-hotspot connection)
  const tcpServer = net.createServer((socket) => {
    const peerAddress = socket.remoteAddress || 'unknown'
    console.log('[checkpoint] Hiker connected (direct offline):', peerAddress)

    socket.on('close', () => {
      console.log('[checkpoint] Hiker disconnected (direct offline):', peerAddress)
    })

    attachReportReceiver(socket, {
      onReport: async (report) => {
        const result = await store.saveReport(report)
        if (result.duplicate) {
          console.log('[checkpoint] Duplicate report:', report.id)
        } else {
          console.log('[checkpoint] Report saved:', report.id)
        }
      },
      onGetReports: async () => {
        return store.getReports()
      }
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

  // 3. Hyperswarm swarm (for topic discovery when online / internet reachable)
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
      onReport: async (report) => {
        const result = await store.saveReport(report)
        if (result.duplicate) {
          console.log('[checkpoint] Duplicate report:', report.id)
        } else {
          console.log('[checkpoint] Report saved:', report.id)
        }
      },
      onGetReports: async () => {
        return store.getReports()
      }
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

module.exports = { startCheckpoint }

// Run directly with: node src/p2p/checkpoint.js
if (require.main === module) {
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
