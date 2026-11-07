import { createServer } from 'node:http'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { loadAlerts } from './checkpoint/alert-store.js'
import { storeTranscript } from './ai/store-alert.js'
import { closeModel } from './ai/extract-report.js'
import { closeTranscriptionModel, transcribeRecording } from './ai/transcribe.js'

const port = Number(process.env.PORT ?? 5173)
const root = resolve('.')
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8'
}

function json (response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}

async function body (request, limit = 12 * 1024 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > limit) throw new Error('Request is too large.')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

async function convertToWav (inputPath, outputPath) {
  await new Promise((resolvePromise, reject) => {
    const process = spawn('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-i', inputPath,
      '-ac', '1', '-ar', '16000', '-sample_fmt', 's16', '-y', outputPath
    ])
    let error = ''
    process.stderr.on('data', chunk => { error += chunk.toString() })
    process.once('error', reject)
    process.once('close', code => {
      if (code === 0) resolvePromise()
      else reject(new Error(error.trim() || 'Could not convert the recording.'))
    })
  })
}

async function transcribeUpload (request) {
  const inputPath = join(tmpdir(), `trailsignal-${randomUUID()}${request.headers['content-type']?.includes('wav') ? '.wav' : '.webm'}`)
  const wavPath = join(tmpdir(), `trailsignal-${randomUUID()}.wav`)
  await writeFile(inputPath, await body(request))
  try {
    await convertToWav(inputPath, wavPath)
    const transcript = await transcribeRecording(wavPath)
    return transcript.trim()
  } finally {
    await Promise.all([unlink(inputPath).catch(() => {}), unlink(wavPath).catch(() => {})])
  }
}

async function serveStatic (request, response) {
  const requested = request.url === '/' ? '/index.html' : request.url
  const filePath = normalize(join(root, requested))
  if (!filePath.startsWith(root)) {
    response.writeHead(403)
    response.end('Forbidden')
    return
  }
  try {
    const content = await readFile(filePath)
    response.writeHead(200, {
      'content-type': mimeTypes[extname(filePath)] ?? 'application/octet-stream'
    })
    response.end(content)
  } catch {
    response.writeHead(404)
    response.end('Not found')
  }
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && request.url === '/api/alerts') {
      json(response, 200, { alerts: await loadAlerts() })
      return
    }
    if (request.method === 'POST' && request.url === '/api/submit') {
      const payload = JSON.parse((await body(request, 64 * 1024)).toString())
      const alert = await storeTranscript(payload.rawTranscript)
      json(response, 201, { alert, reportId: alert.id })
      return
    }
    if (request.method === 'POST' && request.url === '/api/transcribe') {
      const transcript = await transcribeUpload(request)
      json(response, 200, { transcript })
      return
    }
    if (request.method === 'GET') {
      await serveStatic(request, response)
      return
    }
    json(response, 405, { error: 'Method not allowed.' })
  } catch (error) {
    json(response, 400, { error: error.message })
  }
})

server.listen(port, () => {
  console.log(`TrailSignal running at http://localhost:${port}`)
})

async function shutdown () {
  await closeModel()
  await closeTranscriptionModel()
  server.close()
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
