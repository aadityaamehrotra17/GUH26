// test/fetch-reports-test.js
// Fetch stored reports from the checkpoint.
// Usage: node test/fetch-reports-test.js

'use strict'

const { HikerPeer } = require('../src/p2p/peer')

async function main () {
  const peer = new HikerPeer()

  console.log('[hiker-fetch] Connecting to checkpoint...')
  await peer.connect({ timeout: 20000 })
  console.log('[hiker-fetch] Connected. Fetching reports...')

  const reports = await peer.getReports({ timeout: 10000 })
  console.log(`[hiker-fetch] Successfully retrieved ${reports.length} report(s):\n`)

  if (reports.length === 0) {
    console.log('  (no reports currently stored on checkpoint)')
  } else {
    for (const report of reports) {
      console.log(`  • [${report.status.toUpperCase()}] ${report.title}`)
      console.log(`    ID: ${report.id} | Category: ${report.category}`)
      console.log(`    Segment: ${report.trailSegment} | Time: ${report.createdAt}`)
      console.log(`    Description: ${report.description}`)
      console.log(`    Original: "${report.originalText || report.rawTranscript || ''}"`)
      console.log('    ─────────────────────────────────────────────────')
    }
  }

  await peer.destroy()
}

main().catch((err) => {
  console.error('[hiker-fetch] Error:', err.message)
  process.exit(1)
})
