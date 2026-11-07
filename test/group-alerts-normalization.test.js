import test from 'node:test'
import assert from 'node:assert/strict'
import { groupAlerts } from '../src/checkpoint/group-alerts.js'

const baseAlert = {
  createdAt: '2026-11-07T12:00:00.000Z',
  category: 'trail blockage',
  description: 'A landslide blocks the path.'
}

test('groups equivalent Bridge 2 and bridge2 segment wording', () => {
  const groups = groupAlerts([
    {
      ...baseAlert,
      id: 'report-a',
      trailSegment: 'Bridge 2 and summit'
    },
    {
      ...baseAlert,
      id: 'report-b',
      createdAt: '2026-11-07T12:05:00.000Z',
      trailSegment: 'summit and bridge2'
    }
  ])

  assert.equal(groups.length, 1)
  assert.equal(groups[0].reportCount, 2)
})
