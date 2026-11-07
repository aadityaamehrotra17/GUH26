import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const STORE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../data/incoming-transcripts.json'
)

async function loadTranscripts () {
  try {
    const contents = await readFile(STORE_PATH, 'utf8')
    const transcripts = JSON.parse(contents)
    if (!Array.isArray(transcripts)) {
      throw new Error('incoming transcript store must contain an array')
    }
    return transcripts
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw new Error(`Could not read incoming transcript store: ${error.message}`)
  }
}

export async function saveIncomingTranscript (report) {
  const transcripts = await loadTranscripts()
  const existingIndex = transcripts.findIndex(transcript => transcript.id === report.id)
  const entry = {
    ...report,
    receivedAt: new Date().toISOString(),
    processing: 'received'
  }

  if (existingIndex === -1) transcripts.push(entry)
  else transcripts[existingIndex] = { ...transcripts[existingIndex], ...entry }

  await mkdir(dirname(STORE_PATH), { recursive: true })
  await writeFile(STORE_PATH, `${JSON.stringify(transcripts, null, 2)}\n`)
  return entry
}

export async function markIncomingTranscript (id, processing, error) {
  const transcripts = await loadTranscripts()
  const index = transcripts.findIndex(transcript => transcript.id === id)
  if (index === -1) return

  transcripts[index] = {
    ...transcripts[index],
    processing,
    ...(error ? { error } : {})
  }
  await writeFile(STORE_PATH, `${JSON.stringify(transcripts, null, 2)}\n`)
}
