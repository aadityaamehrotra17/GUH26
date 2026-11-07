// src/ui/index.js
import { createRecordReport } from './record-report.js';
import { createAlertList } from './alert-list.js';

/**
 * Initialises the TrailSignal UI across Device A (Hiker), Device B (Checkpoint), and Device C (Viewer).
 *
 * Returns a controller hook object:
 *   - setConnectionStatus(state, detailText)
 *   - logCheckpointEvent({ stage, reportId, rawTranscript, formattedAlert, error })
 *   - refreshAlerts()
 */
export function initTrailSignalUI(rootEl, {
  transcribeRecording,
  submitTranscript,
  getAlerts,
  // Legacy aliases in case a teammate imports using old names:
  sendReport,
  getReports
} = {}) {
  const effectiveSubmit = submitTranscript || sendReport;
  const effectiveGetAlerts = getAlerts || getReports;

  rootEl.innerHTML = `
    <div class="ts-app">
      <header class="ts-header">
        <div>
          <h1 class="ts-title">TrailSignal</h1>
          <p class="ts-tagline">Offline Trail-Safety Alerts (Pear P2P + Local QVAC STT & LLM)</p>
        </div>

        <div class="ts-controls">
          <span id="ts-conn-badge" class="ts-conn-badge ts-conn-connected">
            ● P2P: Connected (Local Topic)
          </span>

          <label for="ts-device-view" class="ts-label-inline">Laptop View:</label>
          <select id="ts-device-view" class="ts-select ts-select-sm">
            <option value="all">All 3 Devices (Demo Split View)</option>
            <option value="device-a">Device A — Hiker (Record & Send)</option>
            <option value="device-b">Device B — Checkpoint (QVAC Format & Store)</option>
            <option value="device-c">Device C — Hiker/Viewer (Retrieve Alerts)</option>
          </select>
        </div>
      </header>

      <section id="ts-checkpoint-panel" class="ts-card ts-checkpoint-card">
        <div class="ts-card-header">
          <div>
            <h2>Device B — Checkpoint Node Activity</h2>
            <p class="ts-subtitle">Receives SUBMIT_REPORT → Runs local QVAC formatAlert() → Saves to JSON store</p>
          </div>
          <span class="ts-badge ts-badge-offline">Checkpoint QVAC LLM</span>
        </div>
        <div id="ts-checkpoint-log" class="ts-checkpoint-log">
          Waiting for incoming SUBMIT_REPORT transcript from Hiker A...
        </div>
      </section>

      <main id="ts-main-grid" class="ts-main-grid">
        <div id="ts-form-mount"></div>
        <div id="ts-list-mount"></div>
      </main>
    </div>
  `;

  const formMount = rootEl.querySelector('#ts-form-mount');
  const listMount = rootEl.querySelector('#ts-list-mount');
  const checkpointPanel = rootEl.querySelector('#ts-checkpoint-panel');
  const checkpointLog = rootEl.querySelector('#ts-checkpoint-log');
  const viewSelect = rootEl.querySelector('#ts-device-view');
  const connBadge = rootEl.querySelector('#ts-conn-badge');

  const alertList = createAlertList(listMount, {
    getAlerts: effectiveGetAlerts
  });

  createRecordReport(formMount, {
    transcribeRecording,
    submitTranscript: effectiveSubmit,
    onSubmitted: () => {
      alertList.refresh();
    }
  });

  // Switch between 3-device views cleanly on any laptop
  viewSelect.addEventListener('change', (e) => {
    const mode = e.target.value;
    formMount.hidden = mode === 'device-b' || mode === 'device-c';
    checkpointPanel.hidden = mode === 'device-a' || mode === 'device-c';
    listMount.hidden = mode === 'device-a';
    rootEl.querySelector('#ts-main-grid').style.gridTemplateColumns =
      mode === 'all' ? '' : '1fr';
  });

  // Initial fetch
  alertList.refresh();

  // Simple hooks exposed to app.js / P2P / Checkpoint modules
  return {
    /**
     * Update the visible P2P connection indicator in the top bar.
     * @param {'connected'|'connecting'|'disconnected'} status
     * @param {string} [label]
     */
    setConnectionStatus(status, label) {
      const normalized = status === 'disconnected' || status === 'connecting' ? status : 'connected';
      const defaultLabels = {
        connected: '● P2P: Connected (Local Topic)',
        connecting: '◐ P2P: Connecting to Peers...',
        disconnected: '○ P2P: Disconnected (Offline Store Active)'
      };
      connBadge.className = `ts-conn-badge ts-conn-${normalized}`;
      connBadge.textContent = label || defaultLabels[normalized];
    },

    /**
     * Displays live Checkpoint QVAC formatting activity on the Checkpoint laptop UI.
     */
    logCheckpointEvent({ stage, reportId, rawTranscript, formattedAlert, error } = {}) {
      if (error) {
        checkpointLog.innerHTML = `
          <div class="ts-cp-entry ts-cp-error">
            <strong>Checkpoint Formatting Fallback (${reportId || 'report'}):</strong> ${error}
            <div>Stored raw transcript with <code>status: "unverified"</code>.</div>
          </div>
        `;
        return;
      }

      checkpointLog.innerHTML = `
        <div class="ts-cp-entry">
          <div><strong>Status:</strong> ${stage || 'Processed SUBMIT_REPORT'} (ID: <code>${reportId || 'n/a'}</code>)</div>
          ${rawTranscript ? `<div class="ts-cp-raw"><strong>Incoming Transcript:</strong> "${rawTranscript}"</div>` : ''}
          ${
            formattedAlert
              ? `<pre class="ts-pre">${JSON.stringify(formattedAlert, null, 2)}</pre>`
              : ''
          }
        </div>
      `;
    },

    refreshAlerts() {
      return alertList.refresh();
    }
  };
}