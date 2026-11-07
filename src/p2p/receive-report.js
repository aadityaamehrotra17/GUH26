import b4a from 'b4a'

const MAX_FRAME_LENGTH = 16_384

const VALID_REPORT_TYPES = new Set([
  'trail_hazard',
  'assistance_request',
  'general'
])

function requireString(value, field, maxLength) {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.length > maxLength
  ) {
    throw new Error(`Invalid report field: ${field}`)
  }

  return value.trim()
}

export function validateReport(report) {
  if (
    !report ||
    typeof report !== 'object' ||
    Array.isArray(report)
  ) {
    throw new Error('Report must be a JSON object')
  }

  const id = typeof report.id === 'string' && report.id.trim()
    ? report.id.trim()
    : (typeof report.reportId === 'string' && report.reportId.trim()
      ? report.reportId.trim()
      : `report-${Date.now()}`)

  const createdAt = (typeof report.createdAt === 'string' && Number.isFinite(Date.parse(report.createdAt)))
    ? report.createdAt
    : new Date().toISOString()

  const rawText = (typeof report.rawTranscript === 'string' && report.rawTranscript.trim())
    ? report.rawTranscript.trim()
    : ((typeof report.originalText === 'string' && report.originalText.trim())
      ? report.originalText.trim()
      : ((typeof report.description === 'string' && report.description.trim())
        ? report.description.trim()
        : ''))

  if (!rawText) {
    throw new Error('Report must include description or rawTranscript')
  }

  const type = VALID_REPORT_TYPES.has(report.type) ? report.type : 'trail_hazard'
  const category = (typeof report.category === 'string' && report.category.trim())
    ? report.category.trim()
    : 'general'
  const title = (typeof report.title === 'string' && report.title.trim())
    ? report.title.trim()
    : 'Trail Alert'
  const description = (typeof report.description === 'string' && report.description.trim())
    ? report.description.trim()
    : rawText
  const trailSegment = (typeof report.trailSegment === 'string' && report.trailSegment.trim())
    ? report.trailSegment.trim()
    : 'unknown'
  const source = (typeof report.source === 'string' && report.source.trim())
    ? report.source.trim()
    : 'hiker-device'

  return {
    id,
    createdAt,
    type,
    category,
    title,
    description,
    trailSegment,
    status: 'unverified', // Enforce unverified status
    source,
    rawTranscript: rawText,
    originalText: rawText
  }
}

export function sendMessage(socket, message) {
  socket.write(b4a.from(JSON.stringify(message) + '\n'))
}

export function sendError(socket, code, message) {
  sendMessage(socket, {
    type: 'REPORT_ERROR',
    code,
    message
  })
}

export function attachReportReceiver(socket, { onReport, onGetReports } = {}) {
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

    if (message?.type !== 'REPORT_SUBMIT' && message?.type !== 'SUBMIT_REPORT') {
      sendError(
        socket,
        'UNSUPPORTED_MESSAGE',
        'Expected REPORT_SUBMIT, SUBMIT_REPORT, GET_REPORTS, or GET_ALERTS message'
      )
      return
    }

    try {
      const input = message.report || message
      const report = validateReport(input)

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
