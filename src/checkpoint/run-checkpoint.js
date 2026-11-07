import { loadAlerts } from './alert-store.js'

const alerts = await loadAlerts()
// Grouping is intentionally disabled for the minimal checkpoint response.
// import { groupAlerts } from './group-alerts.js'

function readableAlert (alert) {
  const date = alert.date ?? alert.createdAt?.slice(0, 10) ?? 'unknown'
  const time = alert.time ?? alert.createdAt?.slice(11, 19) ?? 'unknown'

  return {
    id: alert.id,
    date,
    time,
    category: alert.category,
    description: alert.description,
    trailSegment: alert.trailSegment,
    rawTranscript: alert.rawTranscript
  }
}

console.log(JSON.stringify(alerts.map(readableAlert), null, 2))
