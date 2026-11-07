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
  if (!qvac) {
    throw new Error('QVAC SDK is not available on this device. Use typed report fallback.')
  }

  loadPromise ??= qvac.loadModel({
    modelSrc: qvac.PARAKEET_TDT_0_6B_V3_Q8_0,
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

  const qvac = await getQvac()
  if (!qvac) {
    throw new Error('QVAC SDK is not available on this device. Use typed report fallback.')
  }

  const id = await getModelId(onProgress)
  return qvac.transcribe({
    modelId: id,
    audioChunk: audioFilePath
  })
}

export async function closeTranscriptionModel () {
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
