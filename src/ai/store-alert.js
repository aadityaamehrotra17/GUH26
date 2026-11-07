import { formatAlert, validateTranscript } from './extract-report.js'
import { loadAlerts, saveAlert } from '../checkpoint/alert-store.js'

export async function storeTranscript (rawTranscript, { onProgress } = {}) {
  const transcript = rawTranscript.trim()
  if (!transcript) {
    throw new Error('Cannot store an empty hiking transcript.')
  }

  const validation = await validateTranscript(transcript, { onProgress })
  if (!validation.isUseful) {
    throw new Error(`Report rejected: ${validation.reason}`)
  }

  const fields = await formatAlert(transcript, { onProgress })
  const storedAlerts = await loadAlerts()
  const createdAt = new Date().toISOString()
  const alert = {
    id: `report-${storedAlerts.length + 1}`,
    createdAt,
    date: createdAt.slice(0, 10),
    time: createdAt.slice(11, 19),
    ...fields,
    rawTranscript: transcript
  }

  await saveAlert(alert)
  return alert
}
