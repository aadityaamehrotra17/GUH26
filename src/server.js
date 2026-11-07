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
import { HikerPeer } from './p2p/peer.js'
import { startCheckpoint } from './p2p/checkpoint.js'

const port = Number(process.env.PORT ?? 5173)
const role = (process.env.ROLE || 'hiker').toLowerCase() // 'hiker' | 'checkpoint'
const root = resolve('.')

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8'
}

let activeCheckpoint = null

// If running as checkpoint, start the P2P transport listener & beacon
if (role === 'checkpoint') {
  console.log('[server] Running in CHECKPOINT role. Starting P2P listener...')
  startCheckpoint().then((cp) => {
    activeCheckpoint = cp
  }).catch((err) => {
    console.error('[server] Checkpoint P2P start notice:', err.message)
  })
} else {
  console.log('[server] Running in HIKER role. Will connect to checkpoint via P2P.')
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
    const proc = spawn('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-i', inputPath,
      '-ac', '1', '-ar', '16000', '-sample_fmt', 's16', '-y', outputPath
    ])
    let error = ''
    proc.stderr.on('data', chunk => { error += chunk.toString() })
    proc.once('error', reject)
    proc.once('close', code => {
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
  } catch (err) {
    console.warn('[server] Audio transcription fallback:', err.message)
    throw err
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
    // 1. Get trail alerts
    if (request.method === 'GET' && request.url === '/api/alerts') {
      if (role === 'hiker') {
        try {
          const peer = new HikerPeer()
          await peer.connect({ timeout: 4000 })
          const reports = await peer.getReports({ timeout: 4000 })
          await peer.destroy()
          json(response, 200, { alerts: reports, source: 'p2p-checkpoint' })
          return
        } catch (peerErr) {
          console.warn('[server] P2P fetch notice:', peerErr.message, 'falling back to local cache')
        }
      }

      // Checkpoint or local fallback
      json(response, 200, { alerts: await loadAlerts(), source: 'local' })
      return
    }

    // 2. Submit new report
    if (request.method === 'POST' && request.url === '/api/submit') {
      const payload = JSON.parse((await body(request, 64 * 1024)).toString())
      const rawTranscript = payload.rawTranscript?.trim()
      if (!rawTranscript) {
        throw new Error('rawTranscript is required')
      }

      if (role === 'hiker') {
        try {
          const peer = new HikerPeer()
          await peer.connect({ timeout: 5000 })
          const reportId = `report-${Date.now()}`
          await peer.submitTranscript({
            reportId,
            createdAt: new Date().toISOString(),
            rawTranscript
          }, { timeout: 10000 })
          await peer.destroy()

          json(response, 201, {
            reportId,
            message: 'Report delivered to checkpoint via P2P',
            deliveredVia: 'p2p'
          })
          return
        } catch (peerErr) {
          console.warn('[server] P2P submit notice:', peerErr.message, 'storing locally as fallback')
        }
      }

      // Checkpoint or local fallback
      const alert = await storeTranscript(rawTranscript)
      json(response, 201, { alert, reportId: alert.id, deliveredVia: 'local' })
      return
    }

    // 3. Audio Speech-to-Text
    if (request.method === 'POST' && request.url === '/api/transcribe') {
      const transcript = await transcribeUpload(request)
      json(response, 200, { transcript })
      return
    }

    // 4. Status endpoint
    if (request.method === 'GET' && request.url === '/api/status') {
      json(response, 200, { role, status: 'online' })
      return
    }

    // 5. Static files (HTML / CSS / JS)
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
  console.log(`TrailSignal (${role}) running at http://localhost:${port}`)
})

async function shutdown () {
  if (activeCheckpoint) await activeCheckpoint.destroy()
  await closeModel()
  await closeTranscriptionModel()
  server.close()
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
