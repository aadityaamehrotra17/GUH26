const app = document.querySelector('#app')
let recorder
let chunks = []

const escapeHtml = (value = '') => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')

function shell (content, back = false) {
  app.innerHTML = `
    <div class="page">
      <header class="topbar">
        <button class="wordmark" data-action="home">TrailSignal</button>
        ${back ? '<button class="back" data-action="home">Back</button>' : ''}
      </header>
      ${content}
      <footer>Local trail updates for people on the path.</footer>
    </div>
  `
}

function home () {
  shell(`
    <section class="welcome">
      <p class="eyebrow">TRAIL CHECKPOINT</p>
      <h1>Stay informed<br><em>on the trail.</em></h1>
      <p class="intro">Share something you noticed, or check what other hikers have reported nearby.</p>
      <div class="choice-grid">
        <button class="choice" data-action="report">
          <span class="choice-icon">↗</span>
          <strong>Report something</strong>
          <small>Tell the checkpoint about a hazard or route change.</small>
        </button>
        <button class="choice" data-action="alerts">
          <span class="choice-icon">◌</span>
          <strong>See trail alerts</strong>
          <small>Read the latest reports saved at this checkpoint.</small>
        </button>
      </div>
    </section>
  `)
}

function report () {
  shell(`
    <section class="panel report-panel">
      <p class="eyebrow">NEW REPORT</p>
      <h1>What did you notice?</h1>
      <p class="muted">Keep it simple. Mention what happened and where.</p>
      <div class="record-box">
        <button class="record-button" id="record">●</button>
        <div>
          <strong id="record-label">Tap to record</strong>
          <small id="record-help">Your report will be transcribed on this device.</small>
        </div>
      </div>
      <label for="transcript">Your report</label>
      <textarea id="transcript" placeholder="Example: A tree has fallen across the path near Bridge 2."></textarea>
      <button class="primary" id="send">Send report</button>
      <p class="feedback" id="feedback"></p>
    </section>
  `, true)

  const recordButton = document.querySelector('#record')
  const label = document.querySelector('#record-label')
  const help = document.querySelector('#record-help')
  const text = document.querySelector('#transcript')
  const feedback = document.querySelector('#feedback')

  recordButton.addEventListener('click', async () => {
    if (recorder?.state === 'recording') {
      recorder.stop()
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      feedback.textContent = 'Microphone access is not available. Type your report below.'
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      chunks = []
      recorder = new MediaRecorder(stream)
      recorder.ondataavailable = event => chunks.push(event.data)
      recorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop())
        recordButton.classList.remove('recording')
        label.textContent = 'Transcribing…'
        help.textContent = 'Working locally. This may take a moment.'
        try {
          const audio = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
          const response = await fetch('/api/transcribe', { method: 'POST', body: audio })
          const result = await response.json()
          if (!response.ok) throw new Error(result.error || 'Local transcription failed.')
          text.value = result.transcript
          label.textContent = 'Ready to send'
          help.textContent = 'Review the words, then send your report.'
        } catch (error) {
          label.textContent = 'Tap to record'
          help.textContent = 'Transcription failed. You can type the report below.'
          feedback.textContent = error.message
        }
      }
      recorder.start()
      recordButton.classList.add('recording')
      label.textContent = 'Recording… tap to stop'
      help.textContent = 'Speak clearly and include a nearby landmark.'
    } catch (error) {
      feedback.textContent = `Microphone unavailable: ${error.message}`
    }
  })

  document.querySelector('#send').addEventListener('click', async () => {
    const rawTranscript = text.value.trim()
    if (!rawTranscript) {
      feedback.textContent = 'Add a report before sending.'
      return
    }
    feedback.textContent = 'Delivering report to checkpoint over P2P…'
    try {
      const response = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rawTranscript })
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error?.startsWith('Report rejected') ? 'Report rejected' : (result.error || 'Could not send report.'))
      feedback.textContent = 'Report delivered successfully to checkpoint!'
      text.value = ''
      setTimeout(() => home(), 1200)
    } catch (error) {
      feedback.textContent = error.message
    }
  })
}

function alertCard (alert) {
  const date = alert.date || alert.createdAt?.slice(0, 10) || 'Unknown date'
  const time = alert.time || alert.createdAt?.slice(11, 16) || 'Unknown time'
  const status = (alert.status || 'unverified').toUpperCase()

  return `
    <article class="alert-card">
      <div class="alert-meta">
        <span>${escapeHtml(date)} &bull; ${escapeHtml(time)}</span>
        <span class="unverified-badge">${escapeHtml(status)}</span>
      </div>
      <p class="alert-type">${escapeHtml(alert.category || 'Trail report')}</p>
      <h2>${escapeHtml(alert.description || alert.rawTranscript || 'No description')}</h2>
      <p class="location">📍 ${escapeHtml(alert.trailSegment || 'Location not specified')}</p>
      <details><summary>Original report transcript</summary><p>${escapeHtml(alert.rawTranscript || alert.originalText || '')}</p></details>
    </article>
  `
}

async function alerts () {
  shell(`
    <section class="panel wide">
      <div class="section-heading">
        <div><p class="eyebrow">CHECKPOINT ALERTS</p><h1>Trail alerts</h1></div>
        <button class="quiet" id="refresh">Refresh</button>
      </div>
      <p class="muted" id="alerts-status">Reports saved by hikers at this checkpoint.</p>
      <div id="alerts" class="alerts"><p class="muted">Loading reports…</p></div>
    </section>
  `, true)
  async function load () {
    try {
      const response = await fetch('/api/alerts')
      const result = await response.json()
      const items = result.alerts || []
      const statusText = result.source === 'p2p-checkpoint'
        ? '⚡ Live peer-to-peer updates from trail checkpoint.'
        : 'Reports saved by hikers at this checkpoint.'
      const statusEl = document.querySelector('#alerts-status')
      if (statusEl) statusEl.textContent = statusText

      document.querySelector('#alerts').innerHTML = items.length
        ? items.slice().reverse().map(alertCard).join('')
        : '<p class="empty">No reports have been saved yet.</p>'
    } catch (err) {
      document.querySelector('#alerts').innerHTML = `<p class="empty">Could not load reports: ${escapeHtml(err.message)}</p>`
    }
  }
  document.querySelector('#refresh').addEventListener('click', load)
  await load()
}

document.addEventListener('click', event => {
  const action = event.target.closest('[data-action]')?.dataset.action
  if (action === 'home') home()
  if (action === 'report') report()
  if (action === 'alerts') alerts()
})

home()
