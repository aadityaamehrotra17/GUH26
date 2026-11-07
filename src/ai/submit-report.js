import { closeModel } from './extract-report.js'
import { storeTranscript } from './store-alert.js'

try {
  const rawTranscript = process.argv.slice(2).join(' ').trim()
  if (!rawTranscript) {
    throw new Error('Provide a raw hiking message after the command.')
  }

  const alert = await storeTranscript(rawTranscript, {
    onProgress: (progress) => {
      process.stderr.write(`\rDownloading/loading Qwen: ${progress.percentage.toFixed(0)}%`)
    }
  })

  console.log('\nStored checkpoint alert:')
  console.log(JSON.stringify(alert, null, 2))
} finally {
  await closeModel()
}
