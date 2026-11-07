// peer.js
// Hiker-side P2P connection to the checkpoint.
// Supports both direct offline local-hotspot transport and Hyperswarm swarm discovery.
//
// Usage:
//   const peer = new HikerPeer()
//   await peer.connect()
//   const reports = await peer.getReports()
//   await peer.sendReport(report)
//   await peer.destroy()

'use strict'

const net = require('node:net')
const { EventEmitter } = require('node:events')
const Hyperswarm = require('hyperswarm')
const { TOPIC } = require('./topic')
const { discoverCheckpoint } = require('./beacon')

class HikerPeer extends EventEmitter {
  constructor (options = {}) {
    super()
    this._options = options
    this.swarm = options.swarm || null
    this._conn = null
    this._buffer = ''
    this._onmessage = null
    this.status = 'idle' // 'idle' | 'connecting' | 'connected' | 'disconnected' | 'destroyed'
    this._pendingRequests = new Map()
    this._requestSeq = 0
  }

  get isConnected () {
    return Boolean(this._conn && !this._conn.destroyed && this.status === 'connected')
  }

  // Connect to the checkpoint.
  // Resolves once a connection is established, or rejects on timeout.
  async connect (options = {}) {
    const timeoutMs = options.timeout ?? 30000

    if (this.isConnected) {
      return
    }

    this._setStatus('connecting')

    // 1. Try local-network offline beacon discovery first (instant on phone hotspot)
    const found = await discoverCheckpoint({
      directHost: options.checkpointHost || this._options.checkpointHost || process.env.CHECKPOINT_HOST,
      timeoutMs: options.discoveryTimeout ?? 1200
    })

    if (found && found.tcpPort) {
      console.log(`[hiker] Discovered offline checkpoint at ${found.host}:${found.tcpPort}`)
      console.log('[hiker] Connecting via direct offline transport...')

      return new Promise((resolve, reject) => {
        let timer = null
        if (timeoutMs > 0) {
          timer = setTimeout(() => {
            reject(new Error(
              `[hiker] Connection to checkpoint timed out after ${timeoutMs}ms. ` +
              'Verify checkpoint is running and both devices share the same local hotspot.'
            ))
          }, timeoutMs)
        }

        const socket = net.connect({ host: found.host, port: found.tcpPort }, () => {
          if (timer) clearTimeout(timer)
          this._conn = socket
          this._setupConn(socket)
          this._setStatus('connected')
          console.log('[hiker] connected to checkpoint')
          resolve()
        })

        socket.on('error', (err) => {
          if (timer) clearTimeout(timer)
          this._setStatus('disconnected')
          reject(err)
        })
      })
    }

    // 2. If no local beacon was found, fall back to Hyperswarm swarm (for remote / internet DHT)
    console.log('[hiker] No local beacon found; attempting public Hyperswarm DHT bootstrap...')
    if (!this.swarm) {
      this.swarm = new Hyperswarm()
    }

    return new Promise((resolve, reject) => {
      let timer = null
      let settled = false

      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          if (settled) return
          settled = true
          this._setStatus(this._conn ? 'connected' : 'disconnected')
          reject(new Error(
            `[hiker] Connection to checkpoint timed out after ${timeoutMs}ms. ` +
            'Verify checkpoint is running and both devices share the same local hotspot.'
          ))
        }, timeoutMs)
      }

      const onConnection = (conn) => {
        if (this._conn && !this._conn.destroyed) {
          conn.destroy()
          return
        }

        this._conn = conn
        this._setupConn(conn)
        this._setStatus('connected')
        console.log('[hiker] connected to checkpoint (swarm)')

        if (!settled) {
          settled = true
          if (timer) clearTimeout(timer)
          resolve()
        }
      }

      this.swarm.on('connection', onConnection)
      this.swarm.join(TOPIC, { server: false, client: true })

      this.swarm.flush().catch((err) => {
        if (!settled && !this._conn) {
          settled = true
          if (timer) clearTimeout(timer)
          this._setStatus('disconnected')
          reject(err)
        }
      })
    })
  }

  // Register a handler for raw messages coming from the checkpoint.
  onMessage (handler) {
    this._onmessage = handler
  }

  // Send a report without awaiting ACK directly (original API).
  async sendReport (report) {
    if (!this.isConnected) {
      throw new Error('[hiker] not connected to checkpoint')
    }
    const msg = JSON.stringify({ type: 'REPORT_SUBMIT', report }) + '\n'
    this._conn.write(msg)
  }

  // Submit a report and await explicit confirmation (REPORT_ACK or REPORT_ERROR).
  async submitReport (report, options = {}) {
    if (!this.isConnected) {
      throw new Error('[hiker] not connected to checkpoint')
    }

    const timeoutMs = options.timeout ?? 10000

    return new Promise((resolve, reject) => {
      const targetId = report?.id
      let timer = null

      const handler = (msg) => {
        if (msg.type === 'REPORT_ACK' && (!targetId || msg.reportId === targetId)) {
          cleanup()
          resolve(msg)
        } else if (msg.type === 'REPORT_ERROR') {
          cleanup()
          reject(new Error(`[checkpoint] ${msg.code || 'ERROR'}: ${msg.message || 'Report rejected'}`))
        }
      }

      const cleanup = () => {
        if (timer) clearTimeout(timer)
        this.removeListener('raw_message', handler)
      }

      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          cleanup()
          reject(new Error(`[hiker] Timed out waiting for REPORT_ACK after ${timeoutMs}ms`))
        }, timeoutMs)
      }

      this.on('raw_message', handler)
      this.sendReport(report).catch((err) => {
        cleanup()
        reject(err)
      })
    })
  }

  // Fetch all stored reports from the checkpoint.
  async getReports (options = {}) {
    if (!this.isConnected) {
      throw new Error('[hiker] not connected to checkpoint')
    }

    const timeoutMs = options.timeout ?? 10000

    return new Promise((resolve, reject) => {
      let timer = null

      const handler = (msg) => {
        if (msg.type === 'REPORTS_RESPONSE') {
          cleanup()
          resolve(msg.reports || [])
        } else if (msg.type === 'REPORT_ERROR') {
          cleanup()
          reject(new Error(`[checkpoint] ${msg.code || 'ERROR'}: ${msg.message || 'Failed to fetch reports'}`))
        }
      }

      const cleanup = () => {
        if (timer) clearTimeout(timer)
        this.removeListener('raw_message', handler)
      }

      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          cleanup()
          reject(new Error(`[hiker] Timed out waiting for REPORTS_RESPONSE after ${timeoutMs}ms`))
        }, timeoutMs)
      }

      this.on('raw_message', handler)

      const msg = JSON.stringify({ type: 'GET_REPORTS' }) + '\n'
      this._conn.write(msg, (err) => {
        if (err) {
          cleanup()
          reject(err)
        }
      })
    })
  }

  // README integration contract aliases
  async getAlerts (options) {
    return this.getReports(options)
  }

  async submitTranscript ({ reportId, createdAt, rawTranscript }, options) {
    return this.submitReport({
      id: reportId || `report-${Date.now()}`,
      createdAt: createdAt || new Date().toISOString(),
      type: 'trail_hazard',
      category: 'general',
      title: 'Trail Report',
      description: rawTranscript,
      trailSegment: 'unknown',
      status: 'unverified',
      source: 'hiker-device',
      originalText: rawTranscript
    }, options)
  }

  async destroy () {
    this._setStatus('destroyed')
    if (this._conn) {
      this._conn.destroy()
      this._conn = null
    }
    if (this.swarm) {
      await this.swarm.destroy().catch(() => {})
      this.swarm = null
    }
  }

  // ── private ────────────────────────────────────────────────────────────────

  _setStatus (newStatus) {
    if (this.status !== newStatus) {
      this.status = newStatus
      this.emit('status', newStatus)
    }
  }

  _setupConn (conn) {
    conn.on('data', (chunk) => {
      this._buffer += chunk.toString()
      const lines = this._buffer.split('\n')
      this._buffer = lines.pop()

      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const msg = JSON.parse(line)
          this.emit('raw_message', msg)
          if (this._onmessage) this._onmessage(msg)
        } catch (e) {
          console.error('[hiker] received invalid JSON from checkpoint:', line)
        }
      }
    })

    conn.on('error', (err) => {
      console.error('[hiker] connection error:', err.message)
      this.emit('error', err)
    })

    conn.on('close', () => {
      if (this._conn === conn) {
        console.log('[hiker] disconnected from checkpoint')
        this._conn = null
        if (this.status !== 'destroyed') {
          this._setStatus('disconnected')
        }
      }
    })
  }
}

module.exports = { HikerPeer }
