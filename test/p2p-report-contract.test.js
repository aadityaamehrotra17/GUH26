import test from 'node:test'
import assert from 'node:assert/strict'
import { validateReport } from '../src/p2p/receive-report.js'

test('P2P submissions contain only checkpoint-processing input', () => {
  const report = validateReport({
    id: 'report-1',
    createdAt: '2026-11-07T17:39:00.000Z',
    rawTranscript: 'A landslide blocks the path near Bridge 2.'
  })

  assert.deepEqual(report, {
    id: 'report-1',
    createdAt: '2026-11-07T17:39:00.000Z',
    rawTranscript: 'A landslide blocks the path near Bridge 2.'
  })
})

test('P2P submissions reject preformatted legacy reports', () => {
  assert.throws(
    () => validateReport({
      id: 'report-1',
      createdAt: '2026-11-07T17:39:00.000Z',
      title: 'Trail report',
      description: 'A report'
    }),
    /Invalid report field: rawTranscript/
  )
})
