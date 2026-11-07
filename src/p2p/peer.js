// peer.js
// Hiker-side P2P connection to the checkpoint.
//
// Usage:
//   const peer = new HikerPeer()
//   await peer.connect()
//   peer.onMessage((msg) => console.log('From checkpoint:', msg))
//   await peer.sendReport(report)
//   await peer.destroy()

'use strict'

const Hyperswarm = require('hyperswarm')
const { TOPIC } = require('./topic')

class HikerPeer {
  constructor () {
    this.swarm = new Hyperswarm()
    this._conn = null
    this._buffer = ''   // accumulates chunks until a \n arrives
    this._onmessage = null
  }

  // Connect to the checkpoint.
  // Resolves once a connection is established.
  connect () {
    return new Promise((resolve, reject) => {
      // Client-only: hiker finds the checkpoint, does not advertise itself.
      this.swarm.join(TOPIC, { server: false, client: true })

      this.swarm.on('connection', (conn) => {
        console.log('[hiker] connected to checkpoint')
        this._conn = conn
        this._setupConn(conn)
        resolve()
      })

      // flush() waits until Hyperswarm has finished its first lookup
      this.swarm.flush().catch(reject)
    })
  }

  // Register a handler for messages coming from the checkpoint (ACK / ERROR).
  onMessage (handler) {
    this._onmessage = handler
  }

  // Send a report to the checkpoint.
  // Wraps it in the agreed REPORT_SUBMIT envelope and appends \n.
  async sendReport (report) {
    if (!this._conn) throw new Error('[hiker] not connected to checkpoint')
    const msg = JSON.stringify({ type: 'REPORT_SUBMIT', report }) + '\n'
    this._conn.write(msg)
  }

  async destroy () {
    await this.swarm.destroy()
  }

  // ── private ────────────────────────────────────────────────────────────────

  _setupConn (conn) {
    conn.on('data', (chunk) => {
      // Buffer chunks and parse complete newline-delimited messages.
      this._buffer += chunk.toString()
      const lines = this._buffer.split('\n')
      this._buffer = lines.pop()  // last element may be an incomplete line

      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const msg = JSON.parse(line)
          if (this._onmessage) this._onmessage(msg)
        } catch (e) {
          console.error('[hiker] received invalid JSON from checkpoint:', line)
        }
      }
    })

    conn.on('error', (err) => {
      console.error('[hiker] connection error:', err.message)
    })

    conn.on('close', () => {
      console.log('[hiker] disconnected from checkpoint')
      this._conn = null
    })
  }
}

module.exports = { HikerPeer }
