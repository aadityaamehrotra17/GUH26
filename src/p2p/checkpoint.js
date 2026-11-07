
'use strict'

const path = require('node:path')
const Hyperswarm = require('hyperswarm')

const { TOPIC } = require('./topic')
const { attachReportReceiver } = require('./receive-report')
const { createReportStore } = require('./report-store')

const DEFAULT_STORE_PATH = path.resolve(
  __dirname,
  '../../data/reports.json'
)

async function startCheckpoint(options = {}) {
  const filePath = options.filePath || DEFAULT_STORE_PATH

  // Load persistent reports before accepting new connections.
  const store = await createReportStore(filePath)

  const swarm = new Hyperswarm()

  let shutdownPromise = null

  swarm.on('connection', (socket, peerInfo) => {
    const peerKey = peerInfo?.publicKey
      ? peerInfo.publicKey.toString('hex')
      : 'unknown'

    console.log('[checkpoint] Hiker connected:', peerKey)

    socket.on('close', () => {
      console.log('[checkpoint] Hiker disconnected:', peerKey)
    })

    // Attach the report parser and validator.
    attachReportReceiver(socket, {
      onReport: async (report) => {
        const result = await store.saveReport(report)

        if (result.duplicate) {
          console.log('[checkpoint] Duplicate report:', report.id)
        } else {
          console.log('[checkpoint] Report saved:', report.id)
        }

        // Returning successfully allows the receiver to send REPORT_ACK.
        // A storage failure causes REPORT_ERROR instead.
      }
    })
  })

  swarm.on('error', (error) => {
    console.error('[checkpoint] Swarm error:', error.message)
  })

  console.log('[checkpoint] Joining shared topic...')

  // Checkpoint accepts incoming connections but does not search for peers.
  const discovery = swarm.join(TOPIC, {
    server: true,
    client: false
  })

  // Wait until the checkpoint has announced itself.
  await discovery.flushed()

  const existingReports = await store.getReports()

  console.log('[checkpoint] READY')
  console.log('[checkpoint] Stored reports:', existingReports.length)
  console.log('[checkpoint] Waiting for hikers...')

  async function destroy() {
    if (!shutdownPromise) {
      shutdownPromise = (async () => {
        console.log('[checkpoint] Shutting down...')
        await swarm.destroy()
        console.log('[checkpoint] Stopped.')
      })()
    }

    return shutdownPromise
  }

  return {
    swarm,
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
