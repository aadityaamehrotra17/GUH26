const MODEL_CONTEXT_SIZE = 2048

const EXTRACTION_INSTRUCTIONS = `Format a hiker's trail report into a concise alert.
Return only one valid JSON object with exactly these fields:
{
  "category": "short category",
  "description": "faithful description",
  "trailSegment": "named trail segment, or unknown"
}
Do not invent coordinates, verification, emergency contacts, or facts not present in the text.
If the text does not identify a trail segment, use "unknown".
Do not include generic words such as "the", "path", or "trail" unless they are part of the actual name.`

const VALIDATION_INSTRUCTIONS = `Decide whether a transcript is a genuine, useful hiking report.
A useful report describes a trail hazard, route condition, safety concern, assistance request,
or other actionable information for hikers. Reject conversational filler, model-generated text,
or random words that do not contain useful hiking information. Speech-to-text may contain
grammar errors, repeated sounds, misspellings, or short fragments; do not reject a message
just because it is incomplete or ungrammatical if its meaning clearly describes a possible
trail hazard or safety concern, such as "tree fell down".
Return only one valid JSON object:
{
  "isUseful": true,
  "reason": "short explanation"
}
Set isUseful to false when the transcript is clearly rubbish.`

let qvacModule = null
async function getQvac () {
  if (qvacModule !== null) return qvacModule
  try {
    qvacModule = await import('@qvac/sdk')
    return qvacModule
  } catch {
    qvacModule = false
    return false
  }
}

let modelId
let loadPromise

async function getModelId (onProgress) {
  if (modelId) return modelId

  const qvac = await getQvac()
  if (!qvac) throw new Error('@qvac/sdk is not available on this device.')

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('QVAC model initialization timed out')), 5000)
  )

  loadPromise ??= Promise.race([
    qvac.loadModel({
      modelSrc: qvac.QWEN3_4B_INST_Q4_K_M,
      modelConfig: { ctx_size: MODEL_CONTEXT_SIZE },
      onProgress
    }),
    timeoutPromise
  ])

  try {
    modelId = await loadPromise
    return modelId
  } finally {
    loadPromise = undefined
  }
}

export function fallbackReport (userText) {
  const normalizedText = (userText || '').toLowerCase()
  let category = 'other'
  if (/landslide|rockfall|rock|mudslide/.test(normalizedText)) category = 'landslide'
  else if (/flood|water/.test(normalizedText)) category = 'flood'
  else if (/fire|smoke/.test(normalizedText)) category = 'fire'
  else if (/fallen tree|tree|log/.test(normalizedText)) category = 'fallen_tree'
  else if (/bridge|damaged/.test(normalizedText)) category = 'infrastructure'

  return {
    category,
    description: (userText || '').trim(),
    trailSegment: inferTrailSegment(userText || '')
  }
}

function inferTrailSegment (userText) {
  const betweenMatch = userText.match(/\bbetween\s+(.+?)\s+and\s+(?:the\s+)?(.+?)(?:[.!?]|$)/i)
  if (betweenMatch) return `${betweenMatch[1]} and ${betweenMatch[2]}`.trim()

  const locationMatch = userText.match(/\b(?:at|near|on)\s+([^.!?]+)/i)
  return locationMatch ? locationMatch[1].trim() : 'unknown'
}

function normalizeReport (report, userText) {
  const inferredFallback = fallbackReport(userText)

  return {
    ...report,
    category: report.category === 'short category' || !report.category.trim()
      ? inferredFallback.category
      : report.category.trim(),
    trailSegment: report.trailSegment === 'unknown'
      ? inferredFallback.trailSegment
      : report.trailSegment.trim()
  }
}

function parseReport (content, userText) {
  const jsonMatch = content.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return fallbackReport(userText)

  try {
    const report = JSON.parse(jsonMatch[0])
    if (
      typeof report !== 'object' ||
      report === null ||
      typeof report.category !== 'string' ||
      typeof report.description !== 'string' ||
      typeof report.trailSegment !== 'string' ||
      !report.description.trim() ||
      !report.trailSegment.trim()
    ) {
      return fallbackReport(userText)
    }

    return normalizeReport({
      category: report.category.trim(),
      description: report.description.trim(),
      trailSegment: report.trailSegment.trim()
    }, userText)
  } catch {
    return fallbackReport(userText)
  }
}

function parseValidation (content) {
  const jsonMatch = content.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    throw new Error('The local model returned an invalid transcript validation response.')
  }

  try {
    const result = JSON.parse(jsonMatch[0])
    if (typeof result.isUseful !== 'boolean') {
      throw new Error('Transcript validation did not include a boolean isUseful field.')
    }
    return {
      isUseful: result.isUseful,
      reason: typeof result.reason === 'string' ? result.reason.trim() : 'No reason provided.'
    }
  } catch (error) {
    throw new Error(`Could not parse transcript validation response: ${error.message}`)
  }
}

export async function validateTranscript (userText, { onProgress } = {}) {
  if (typeof userText !== 'string' || !userText.trim()) {
    throw new TypeError('userText must be a non-empty string')
  }

  try {
    const qvac = await getQvac()
    if (!qvac) {
      // Safe offline fallback validation: simple check for meaningful content
      return { isUseful: userText.trim().length > 3, reason: 'Offline validated' }
    }

    const id = await getModelId(onProgress)
    const run = qvac.completion({
      modelId: id,
      history: [
        { role: 'system', content: `${VALIDATION_INSTRUCTIONS} /no_think` },
        { role: 'user', content: userText.trim() }
      ],
      stream: false
    })
    const result = await run.final
    return parseValidation(result.contentText)
  } catch {
    // If local LLM fails or is uninstalled, do not reject valid reports
    return { isUseful: true, reason: 'Fallback validation' }
  }
}

export async function formatAlert (userText, { onProgress } = {}) {
  if (typeof userText !== 'string' || !userText.trim()) {
    throw new TypeError('userText must be a non-empty string')
  }

  try {
    const qvac = await getQvac()
    if (!qvac) {
      return fallbackReport(userText)
    }

    const id = await getModelId(onProgress)
    const run = qvac.completion({
      modelId: id,
      history: [
        { role: 'system', content: `${EXTRACTION_INSTRUCTIONS} /no_think` },
        { role: 'user', content: userText.trim() }
      ],
      stream: false
    })
    const result = await run.final
    return parseReport(result.contentText, userText)
  } catch (err) {
    console.warn(`[qvac] Model inference notice: ${err.message}. Using rule-based fallback.`)
    return fallbackReport(userText)
  }
}

export async function closeModel () {
  if (!modelId) return
  const id = modelId
  modelId = undefined
  try {
    const qvac = await getQvac()
    if (qvac) {
      await qvac.unloadModel({ modelId: id, clearStorage: false })
    }
  } catch {}
}
