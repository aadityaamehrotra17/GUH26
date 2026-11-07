import {
  completion,
  loadModel,
  unloadModel,
  QWEN3_4B_INST_Q4_K_M
} from '@qvac/sdk'

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
random words, incomplete fragments, and messages that do not contain useful hiking information.
Return only one valid JSON object:
{
  "isUseful": true,
  "reason": "short explanation"
}
Set isUseful to false when the transcript is clearly rubbish.`

let modelId
let loadPromise

async function getModelId (onProgress) {
  if (modelId) return modelId

  loadPromise ??= loadModel({
    modelSrc: QWEN3_4B_INST_Q4_K_M,
    modelConfig: { ctx_size: MODEL_CONTEXT_SIZE },
    onProgress
  })

  try {
    modelId = await loadPromise
    return modelId
  } finally {
    loadPromise = undefined
  }
}

function fallbackReport (userText) {
  const normalizedText = userText.toLowerCase()
  let category = 'other'
  if (/landslide|rockfall|rock|mudslide/.test(normalizedText)) category = 'landslide'
  else if (/flood|water/.test(normalizedText)) category = 'flood'
  else if (/fire|smoke/.test(normalizedText)) category = 'fire'
  else if (/fallen tree|tree/.test(normalizedText)) category = 'fallen_tree'

  return {
    category,
    description: userText.trim(),
    trailSegment: inferTrailSegment(userText)
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

  const id = await getModelId(onProgress)
  const run = completion({
    modelId: id,
    history: [
      { role: 'system', content: `${VALIDATION_INSTRUCTIONS} /no_think` },
      { role: 'user', content: userText.trim() }
    ],
    stream: false
  })
  const result = await run.final
  return parseValidation(result.contentText)
}

export async function formatAlert (userText, { onProgress } = {}) {
  if (typeof userText !== 'string' || !userText.trim()) {
    throw new TypeError('userText must be a non-empty string')
  }

  const id = await getModelId(onProgress)
  const run = completion({
    modelId: id,
    history: [
      { role: 'system', content: `${EXTRACTION_INSTRUCTIONS} /no_think` },
      { role: 'user', content: userText.trim() }
    ],
    stream: false
  })
  const result = await run.final
  return parseReport(result.contentText, userText)
}

export async function closeModel () {
  if (!modelId) return
  const id = modelId
  modelId = undefined
  await unloadModel({ modelId: id, clearStorage: false })
}
