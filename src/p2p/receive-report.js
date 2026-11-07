
const b4a = require('b4a')

const MAX_FRAME_LENGTH = 16_384

const VALID_REPORT_TYPES = new Set([
  'trail_hazard',
  'assistance_request'
])

const VALID_STATUSES = new Set(['unverified'])

function requireString(value, field, maxLength) {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.length > maxLength
  ) {
    throw new Error(`Invalid report field: ${field}`)
  }

  return value
}

function validateReport(report) {
  if (
    !report ||
    typeof report !== 'object' ||
    Array.isArray(report)
  ) {
    throw new Error('Report must be a JSON object')
  }

  requireString(report.id, 'id', 128)

  if (
    typeof report.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(report.createdAt))
  ) {
    throw new Error('Invalid report timestamp')
  }

  if (!VALID_REPORT_TYPES.has(report.type)) {
    throw new Error('Unsupported report type')
  }

  if (!VALID_STATUSES.has(report.status)) {
    throw new Error('Incoming reports must be unverified')
  }

  requireString(report.category, 'category', 80)
  requireString(report.title, 'title', 120)
  requireString(report.description, 'description', 2000)
  requireString(report.trailSegment, 'trailSegment', 120)
  requireString(report.source, 'source', 120)
  requireString(report.originalText, 'originalText', 2000)

  return report
}

function sendMessage(socket, message) {
  socket.write(b4a.from(JSON.stringify(message) + '\n'))
}

function sendError(socket, code, message) {
  sendMessage(socket, {
    type: 'REPORT_ERROR',
    code,
    message
  })
}

function attachReportReceiver(socket, { onReport, onGetReports } = {}) {
  if (typeof onReport !== 'function') {
    throw new TypeError('onReport callback is required')
  }

  let buffer = ''
  let processing = Promise.resolve()

  async function processFrame(frame) {
    let message

    try {
      message = JSON.parse(frame)
    } catch {
      sendError(socket, 'INVALID_JSON', 'Message is not valid JSON')
      return
    }

    if (message?.type === 'GET_REPORTS' || message?.type === 'GET_ALERTS') {
      if (typeof onGetReports !== 'function') {
        sendError(
          socket,
          'FEATURE_UNAVAILABLE',
          'Retrieving reports is not supported'
        )
        return
      }

      try {
        const reports = await onGetReports()
        sendMessage(socket, {
          type: 'REPORTS_RESPONSE',
          reports: Array.isArray(reports) ? reports : []
        })
        console.log(`[checkpoint] Served ${Array.isArray(reports) ? reports.length : 0} reports`)
      } catch (error) {
        sendError(
          socket,
          'REPORTS_FETCH_FAILED',
          error.message || 'Could not fetch reports'
        )
      }
      return
    }

    if (message?.type !== 'REPORT_SUBMIT') {
      sendError(
        socket,
        'UNSUPPORTED_MESSAGE',
        'Expected REPORT_SUBMIT, GET_REPORTS, or GET_ALERTS message'
      )
      return
    }

    try {
      const report = validateReport(message.report)

      // Store the report before acknowledging delivery.
      await onReport(report)

      sendMessage(socket, {
        type: 'REPORT_ACK',
        reportId: report.id,
        received: true
      })

      console.log(`[checkpoint] Accepted report ${report.id}`)
    } catch (error) {
      sendError(
        socket,
        'REPORT_REJECTED',
        error.message || 'Could not process report'
      )
    }
  }

  function onData(chunk) {
    buffer += b4a.toString(chunk)

    let newlineIndex

    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
      const frame = buffer.slice(0, newlineIndex).trim()
      buffer = buffer.slice(newlineIndex + 1)

      if (!frame) continue

      if (frame.length > MAX_FRAME_LENGTH) {
        sendError(socket, 'FRAME_TOO_LARGE', 'Message is too large')
        continue
      }

      processing = processing.then(() => processFrame(frame))
    }

    if (buffer.length > MAX_FRAME_LENGTH) {
      sendError(
        socket,
        'FRAME_TOO_LARGE',
        'Incomplete message is too large'
      )

      buffer = ''
      socket.destroy()
    }
  }

  socket.on('data', onData)

  socket.on('error', (error) => {
    console.error('[checkpoint] Socket error:', error.message)
  })

  return () => {
    socket.removeListener('data', onData)
  }
}

module.exports = {
  validateReport,
  attachReportReceiver
}
