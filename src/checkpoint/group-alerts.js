const GROUP_WINDOW_MS = 30 * 60 * 1000
const LOCATION_STOP_WORDS = new Set([
  'and',
  'at',
  'near',
  'on',
  'path',
  'the',
  'to',
  'trail'
])

function normalizeText (value) {
  return value
    .toLowerCase()
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(the|path|trail)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .sort()
    .join(' ')
}

function locationTokens (trailSegment) {
  return new Set(
    normalizeText(trailSegment)
      .split(' ')
      .filter((token) => token && !LOCATION_STOP_WORDS.has(token))
  )
}

function locationsMatch (first, second) {
  if (!first || !second) return false

  const firstNormalized = normalizeText(first)
  const secondNormalized = normalizeText(second)
  if (
    !firstNormalized ||
    !secondNormalized ||
    firstNormalized === 'unknown' ||
    secondNormalized === 'unknown'
  ) {
    return false
  }

  const firstTokens = locationTokens(first)
  const secondTokens = locationTokens(second)
  const sharedTokens = [...firstTokens].filter((token) => secondTokens.has(token))
  return sharedTokens.length >= Math.min(firstTokens.size, secondTokens.size) / 2
}

function sameGroup (alert, group) {
  if (normalizeText(alert.category) !== normalizeText(group.category)) return false

  const alertTime = Date.parse(alert.createdAt)
  const groupTime = Date.parse(group.latestCreatedAt)
  if (Number.isNaN(alertTime) || Number.isNaN(groupTime)) return false
  if (Math.abs(alertTime - groupTime) > GROUP_WINDOW_MS) return false

  return locationsMatch(alert.trailSegment, group.trailSegment)
}

function createGroup (alert) {
  return {
    id: `incident-${alert.id}`,
    category: alert.category,
    trailSegment: alert.trailSegment,
    latestCreatedAt: alert.createdAt,
    alerts: [alert]
  }
}

function addToGroup (group, alert) {
  group.alerts.push(alert)
  if (Date.parse(alert.createdAt) > Date.parse(group.latestCreatedAt)) {
    group.latestCreatedAt = alert.createdAt
    group.trailSegment = alert.trailSegment
  }
}

function publicAlert (alert) {
  return {
    id: alert.id,
    createdAt: alert.createdAt,
    category: alert.category,
    description: alert.description,
    trailSegment: alert.trailSegment,
    rawTranscript: alert.rawTranscript
  }
}

export function groupAlerts (alerts) {
  if (!Array.isArray(alerts)) {
    throw new TypeError('alerts must be an array')
  }

  const groups = []
  for (const alert of alerts) {
    const matchingGroup = groups.find((group) => sameGroup(alert, group))
    if (matchingGroup) addToGroup(matchingGroup, alert)
    else groups.push(createGroup(alert))
  }

  return groups
    .map((group) => {
      const sortedAlerts = [...group.alerts].sort(
        (first, second) => Date.parse(second.createdAt) - Date.parse(first.createdAt)
      )

      return {
        id: group.id,
        category: group.category,
        trailSegment: group.trailSegment,
        description: sortedAlerts[0].description,
        createdAt: sortedAlerts[0].createdAt,
        reportCount: sortedAlerts.length,
        primaryAlert: publicAlert(sortedAlerts[0]),
        relatedAlerts: sortedAlerts.slice(1).map(publicAlert)
      }
    })
    .sort((first, second) => Date.parse(second.createdAt) - Date.parse(first.createdAt))
}
