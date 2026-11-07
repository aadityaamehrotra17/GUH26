import { closeTranscriptionModel, transcribeRecording } from './transcribe.js'

const audioFilePath = process.argv[2]
if (!audioFilePath) {
  console.error('Usage: npm run ai:transcribe -- path/to/report.wav')
  process.exitCode = 1
} else {
  try {
    const text = await transcribeRecording(audioFilePath, {
      onProgress: (progress) => {
        process.stderr.write(`\rDownloading/loading speech model: ${progress.percentage.toFixed(0)}%`)
      }
    })

    console.log('\nRaw transcript:')
    console.log(text.trim())
  } finally {
    await closeTranscriptionModel()
  }
}
