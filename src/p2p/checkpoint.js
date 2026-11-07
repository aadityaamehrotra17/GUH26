// src/p2p/checkpoint.js
// Checkpoint-side P2P listener, offline DHT bootstrapper, and report store.

'use strict'

const path = require('node:path')
const HyperDHT = require('hyperdht')
const Hyperswarm = require('hyperswarm')

const { TOPIC } = require('./topic')
const { attachReportReceiver } = require('./receive-report')
const { createReportStore } = require('./report-store')
const { startCheckpointBeacon, getLocalIPv4, DEFAULT_DHT_PORT } = require('./beacon')

const DEFAULT_STORE_PATH = path.resolve(
  __dirname,
  '../../data/reports.json'
)

async function startCheckpoint(options = {}) {
  const filePath = options.filePath || DEFAULT_STORE_PATH
  const host = options.host || getLocalIPv4()
  const dhtPort = options.dhtPort || DEFAULT_DHT_PORT

  // Load persistent reports before accepting new connections.
  const store = await createReportStore(filePath)

  // Start local DHT bootstrapper for 100% offline local-network discovery.
  let bootstrapper = null
  try {
    bootstrapper = HyperDHT.bootstrapper(dhtPort, host)
    await bootstrapper.ready()
    console.log(`[checkpoint] Offline DHT bootstrapper active on ${host}:${dhtPort}`)
  } catch (err) {
    console.log('[checkpoint] Local DHT bootstrapper notice:', err.message)
  }

  // Start UDP discovery beacon for zero-config offline discovery by hikers.
  let beacon = null
  try {
    beacon = await startCheckpointBeacon({ host, dhtPort })
  } catch (err) {
    console.log('[checkpoint] UDP beacon notice:', err.message)
  }

  const bootstrapNodes = bootstrapper
    ? [{ host, port: dhtPort }]
    : undefined

  const swarm = new Hyperswarm({ bootstrap: bootstrapNodes })

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
      },
      onGetReports: async () => {
        return store.getReports()
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
  console.log('[checkpoint] Local IP:', host)
  console.log('[checkpoint] Stored reports:', existingReports.length)
  console.log('[checkpoint] Waiting for hikers...')

  async function destroy() {
    if (!shutdownPromise) {
      shutdownPromise = (async () => {
        console.log('[checkpoint] Shutting down...')
        await swarm.destroy()
        if (beacon) await beacon.destroy()
        if (bootstrapper) await bootstrapper.destroy()
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
