import test from 'node:test'
import assert from 'node:assert/strict'
import { groupAlerts } from '../src/checkpoint/group-alerts.js'

function alert (overrides = {}) {
  return {
    id: 'report-1',
    createdAt: '2026-11-07T12:00:00.000Z',
    category: 'landslide',
    description: 'A landslide was reported.',
    trailSegment: 'Bridge 2 to Summit',
    rawTranscript: 'A landslide was reported.',
    ...overrides
  }
}

test('groups recent alerts with the same category and trail area', () => {
  const groups = groupAlerts([
    alert({ id: 'report-a' }),
    alert({
      id: 'report-b',
      createdAt: '2026-11-07T12:20:00.000Z',
      trailSegment: 'Bridge 2 and Summit'
    })
  ])

  assert.equal(groups.length, 1)
  assert.equal(groups[0].reportCount, 2)
  assert.equal(groups[0].primaryAlert.id, 'report-b')
  assert.equal(groups[0].relatedAlerts[0].id, 'report-a')
})

test('does not group different categories or old reports', () => {
  const groups = groupAlerts([
    alert({ id: 'report-a' }),
    alert({
      id: 'report-b',
      category: 'fire',
      createdAt: '2026-11-07T12:10:00.000Z'
    }),
    alert({
      id: 'report-c',
      createdAt: '2026-11-07T12:31:00.000Z'
    })
  ])

  assert.equal(groups.length, 3)
})

test('does not group alerts with unknown trail segments', () => {
  const groups = groupAlerts([
    alert({ id: 'report-a', trailSegment: 'unknown' }),
    alert({ id: 'report-b', trailSegment: 'unknown' })
  ])

  assert.equal(groups.length, 2)
})

test('keeps every original alert in the grouped result', () => {
  const alerts = [
    alert({ id: 'report-a' }),
    alert({
      id: 'report-b',
      createdAt: '2026-11-07T12:05:00.000Z',
      trailSegment: 'Bridge 2'
    })
  ]

  const groups = groupAlerts(alerts)
  assert.deepEqual(
    groups.flatMap((group) => [group.primaryAlert, ...group.relatedAlerts]).map(({ id }) => id).sort(),
    ['report-a', 'report-b']
  )
})
