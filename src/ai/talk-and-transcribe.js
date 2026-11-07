import { spawn } from 'node:child_process'
import { mkdir, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { closeModel } from './extract-report.js'
import { storeTranscript } from './store-alert.js'
import { closeTranscriptionModel, transcribeRecording } from './transcribe.js'

const recordingsDirectory = resolve('data/recordings')
const recordingPath = resolve(recordingsDirectory, `report-${Date.now()}.wav`)
const terminal = readline.createInterface({ input, output })

async function recordMicrophone () {
  await mkdir(recordingsDirectory, { recursive: true })
  await terminal.question('Press Enter to start recording...')

  const recorder = spawn('ffmpeg', [
    '-hide_banner',
    '-loglevel', 'error',
    '-f', 'avfoundation',
    '-i', ':0',
    '-ac', '1',
    '-ar', '16000',
    '-sample_fmt', 's16',
    '-y',
    recordingPath
  ], { stdio: ['pipe', 'ignore', 'pipe'] })

  let errorOutput = ''
  recorder.stderr.on('data', (chunk) => {
    errorOutput += chunk.toString()
  })

  console.log('Recording... speak your hiking report.')
  await terminal.question('Press Enter to stop recording.')
  recorder.stdin.write('q')
  recorder.stdin.end()

  const exitCode = await new Promise((resolveExit) => {
    recorder.once('close', resolveExit)
  })

  if (exitCode !== 0) {
    throw new Error(`Microphone recording failed: ${errorOutput.trim()}`)
  }

  const file = await stat(recordingPath)
  if (file.size < 32000) {
    throw new Error('Recording was shorter than one second. Hold the recording open while speaking.')
  }

  return recordingPath
}

try {
  const audioFilePath = await recordMicrophone()
  console.log(`Saved recording: ${audioFilePath}`)
  console.log('Transcribing locally...')

  const transcript = await transcribeRecording(audioFilePath, {
    onProgress: (progress) => {
      process.stderr.write(`\rDownloading/loading speech model: ${progress.percentage.toFixed(0)}%`)
    }
  })

  console.log('\nRaw transcript:')
  const rawTranscript = transcript.trim()
  console.log(rawTranscript)

  const alert = await storeTranscript(rawTranscript, {
    onProgress: (progress) => {
      process.stderr.write(`\rDownloading/loading Qwen: ${progress.percentage.toFixed(0)}%`)
    }
  })

  console.log('\nStored checkpoint alert:')
  console.log(JSON.stringify(alert, null, 2))
} finally {
  terminal.close()
  await closeTranscriptionModel()
  await closeModel()
}
