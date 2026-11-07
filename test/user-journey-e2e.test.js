// test/user-journey-e2e.test.js
// Tests the full MVP user journey from the README end-to-end.

import { startCheckpoint } from '../src/p2p/checkpoint.js'
import { HikerPeer } from '../src/p2p/peer.js'
import { loadAlerts } from '../src/checkpoint/alert-store.js'

async function runTest () {
  console.log('=== Step 1: Starting Checkpoint ===')
  const checkpoint = await startCheckpoint({ filePath: './data/checkpoint-alerts.json' })

  console.log('\n=== Step 2: Hiker A connects and submits raw transcript over P2P ===')
  const hikerA = new HikerPeer()
  await hikerA.connect()

  const hikerATranscript = 'A massive landslide is completely blocking the path between Bridge 2 and the summit.'
  console.log('[Hiker A] Submitting raw transcript:', hikerATranscript)
  const reportId = 'journey-' + Date.now()
  const ack = await hikerA.submitTranscript({
    reportId,
    createdAt: new Date().toISOString(),
    rawTranscript: hikerATranscript
  })
  console.log('[Hiker A] ✅ ACK received from checkpoint:', ack)

  console.log('\n=== Step 3: Hiker A disconnects ===')
  await hikerA.destroy()
  console.log('[Hiker A] Disconnected.')

  console.log('\n=== Step 4: Checkpoint has formatted & persisted alert ===')
  const saved = await loadAlerts()
  const latestAlert = saved.find(a => a.id === reportId)
  if (!latestAlert) throw new Error('Alert was not persisted on checkpoint!')

  console.log('[Checkpoint Stored Alert]:', {
    id: latestAlert.id,
    category: latestAlert.category,
    trailSegment: latestAlert.trailSegment,
    status: latestAlert.status,
    description: latestAlert.description,
    rawTranscript: latestAlert.rawTranscript
  })

  console.log('\n=== Step 5: Hiker B connects later and retrieves alerts over P2P ===')
  const hikerB = new HikerPeer()
  await hikerB.connect()
  const fetchedAlerts = await hikerB.getReports()
  console.log('[Hiker B] Total alerts retrieved:', fetchedAlerts.length)

  const matched = fetchedAlerts.find(a => a.id === reportId)
  if (!matched) throw new Error('Hiker B could not find the alert!')

  console.log('[Hiker B Verified Display]:')
  console.log('  STATUS:     [' + matched.status.toUpperCase() + ']')
  console.log('  CATEGORY:   ' + matched.category)
  console.log('  LOCATION:   ' + matched.trailSegment)
  console.log('  SUMMARY:    ' + matched.description)
  console.log('  ORIGINAL:   ' + (matched.rawTranscript || matched.originalText))

  await hikerB.destroy()
  await checkpoint.destroy()

  console.log('\n=== ALL USER JOURNEY STEPS PASSED 100%! ===')
}

runTest().catch((err) => {
  console.error('Test failed:', err)
  process.exit(1)
})
