// test/hiker-test.js
// Quick smoke test — run this once your teammate's checkpoint is up.
// Usage: node test/hiker-test.js

'use strict'

const { HikerPeer } = require('../src/p2p/peer')

const TEST_REPORT = {
  id: `test-${Date.now()}`,
  createdAt: new Date().toISOString(),
  type: 'trail_hazard',
  category: 'landslide',
  title: 'Path blocked by landslide',
  description: 'Rocks and mud are blocking the path.',
  trailSegment: 'Bridge 2 to Summit',
  status: 'unverified',
  source: 'hiker-device',
  originalText: 'Rocks and mud are blocking the path.'
}

async function main () {
  const peer = new HikerPeer()

  peer.onMessage((msg) => {
    if (msg.type === 'REPORT_ACK') {
      console.log('[test] ✅ ACK received — report delivered:', msg.reportId)
    } else if (msg.type === 'REPORT_ERROR') {
      console.error('[test] ❌ ERROR from checkpoint:', msg.code, msg.message)
    } else {
      console.log('[test] unknown message:', msg)
    }
    peer.destroy()
  })

  console.log('[test] connecting to checkpoint...')
  await peer.connect()

  console.log('[test] sending report...')
  await peer.sendReport(TEST_REPORT)
}

main().catch((err) => {
  console.error('[test] fatal:', err.message)
  process.exit(1)
})
