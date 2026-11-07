import {
  loadModel,
  transcribe,
  unloadModel,
  PARAKEET_TDT_0_6B_V3_Q8_0
} from '@qvac/sdk'

let modelId
let loadPromise

async function getModelId (onProgress) {
  if (modelId) return modelId

  loadPromise ??= loadModel({
    modelSrc: PARAKEET_TDT_0_6B_V3_Q8_0,
    modelType: 'parakeet-transcription',
    onProgress
  })

  try {
    modelId = await loadPromise
    return modelId
  } finally {
    loadPromise = undefined
  }
}

export async function transcribeRecording (audioFilePath, { onProgress } = {}) {
  if (typeof audioFilePath !== 'string' || !audioFilePath.trim()) {
    throw new TypeError('audioFilePath must be a non-empty string')
  }

  const id = await getModelId(onProgress)
  return transcribe({
    modelId: id,
    audioChunk: audioFilePath
  })
}

export async function closeTranscriptionModel () {
  if (!modelId) return
  const id = modelId
  modelId = undefined
  await unloadModel({ modelId: id, clearStorage: false })
}
