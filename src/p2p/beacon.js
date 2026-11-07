// src/p2p/beacon.js
// Offline local network beacon and discovery service.
// Allows hikers and checkpoints on the same hotspot/Wi-Fi to discover each other
// with ZERO internet and without hardcoding IP addresses.

'use strict'

const dgram = require('node:dgram')
const os = require('node:os')

const BEACON_PORT = 49738
const DEFAULT_TCP_PORT = 49736
const DEFAULT_DHT_PORT = 49737

function getLocalIPv4 () {
  const ifaces = os.networkInterfaces()
  const candidates = []

  for (const [name, list] of Object.entries(ifaces)) {
    const isVirtual = /vethernet|hyper-v|wsl|virtual|docker/i.test(name)
    for (const iface of list) {
      if (iface.family === 'IPv4' && !iface.internal) {
        if (!isVirtual) {
          candidates.unshift(iface.address)
        } else {
          candidates.push(iface.address)
        }
      }
    }
  }

  return candidates[0] || '127.0.0.1'
}

function getBroadcastAddresses () {
  const broadcasts = ['255.255.255.255']
  const ifaces = os.networkInterfaces()

  for (const [name, list] of Object.entries(ifaces)) {
    if (/vethernet|hyper-v|wsl|virtual|docker/i.test(name)) continue
    for (const iface of list) {
      if (iface.family === 'IPv4' && !iface.internal && iface.netmask) {
        try {
          const ipParts = iface.address.split('.').map(Number)
          const maskParts = iface.netmask.split('.').map(Number)
          const bcast = ipParts.map((p, i) => (p | (~maskParts[i] & 255))).join('.')
          broadcasts.push(bcast)
        } catch {
          // ignore netmask parse error
        }
      }
    }
  }

  return [...new Set(broadcasts)]
}

// Start beacon responder on the Checkpoint.
// Listens for TRAILSIGNAL_DISCOVER and replies with its direct TCP and DHT coordinates.
function startCheckpointBeacon (options = {}) {
  const host = options.host || getLocalIPv4()
  const tcpPort = options.tcpPort || DEFAULT_TCP_PORT
  const dhtPort = options.dhtPort || DEFAULT_DHT_PORT
  const port = options.port || BEACON_PORT

  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })

  socket.on('message', (msg, rinfo) => {
    const text = msg.toString().trim()
    if (text === 'TRAILSIGNAL_DISCOVER') {
      const response = Buffer.from(JSON.stringify({
        type: 'TRAILSIGNAL_BEACON',
        host,
        tcpPort,
        dhtPort
      }))
      socket.send(response, rinfo.port, rinfo.address, (err) => {
        if (err) console.error('[checkpoint-beacon] send error:', err.message)
      })
    }
  })

  socket.on('error', (err) => {
    console.error('[checkpoint-beacon] socket error:', err.message)
  })

  return new Promise((resolve) => {
    socket.bind(port, () => {
      try {
        socket.setBroadcast(true)
      } catch {}
      console.log(`[checkpoint-beacon] Listening on UDP ${port} (announcing ${host}:${tcpPort})`)
      resolve({
        host,
        tcpPort,
        dhtPort,
        destroy: () => new Promise((res) => socket.close(res))
      })
    })
  })
}

// Hiker: broadcast discovery request to find nearby checkpoint.
async function discoverCheckpoint (options = {}) {
  const directHost = options.directHost || process.env.CHECKPOINT_HOST
  const tcpPort = options.tcpPort || DEFAULT_TCP_PORT
  const dhtPort = options.dhtPort || DEFAULT_DHT_PORT

  if (directHost) {
    return { host: directHost, tcpPort, dhtPort, direct: true }
  }

  const timeoutMs = options.timeoutMs ?? 1500
  const port = options.port || BEACON_PORT
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })

  return new Promise((resolve) => {
    let settled = false

    const cleanup = () => {
      if (!settled) {
        settled = true
        try { socket.close() } catch {}
      }
    }

    const timer = setTimeout(() => {
      cleanup()
      resolve(null) // none found within timeout, will fall back to public DHT
    }, timeoutMs)

    socket.on('message', (msg, rinfo) => {
      try {
        const data = JSON.parse(msg.toString())
        if (data.type === 'TRAILSIGNAL_BEACON') {
          clearTimeout(timer)
          cleanup()
          resolve({
            host: rinfo.address,
            tcpPort: data.tcpPort || tcpPort,
            dhtPort: data.dhtPort || dhtPort
          })
        }
      } catch {}
    })

    socket.on('error', () => {
      clearTimeout(timer)
      cleanup()
      resolve(null)
    })

    socket.bind(0, () => {
      try {
        socket.setBroadcast(true)
      } catch {}

      const req = Buffer.from('TRAILSIGNAL_DISCOVER')
      const targets = getBroadcastAddresses()

      for (const target of targets) {
        socket.send(req, port, target, () => {})
      }
    })
  })
}

module.exports = {
  BEACON_PORT,
  DEFAULT_TCP_PORT,
  DEFAULT_DHT_PORT,
  getLocalIPv4,
  getBroadcastAddresses,
  startCheckpointBeacon,
  discoverCheckpoint
}
