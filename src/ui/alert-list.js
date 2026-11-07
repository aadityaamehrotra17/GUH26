// Renders the reports fetched from the checkpoint via getReports(), 
// clearly flagging unverified reports, showing the trail segment,
//  report type, category, timestamp, original text, and a trail-safety banner for Hiker B.

// Renders the ALERTS array returned by getAlerts(). It prominently displays the UNVERIFIED badge, timestamp, structured alert fields (title, category, trailSegment, description), and always shows rawTranscript alongside the model summary so hikers can verify the source text.

// src/ui/alert-list.js

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTime(isoString) {
  if (!isoString) return 'Unknown time';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;
  return (
    date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) +
    ' (' +
    date.toLocaleDateString() +
    ')'
  );
}

/**
 * Mounts the Checkpoint Alert Feed for Device C (Hiker Viewer) and Device B (Checkpoint).
 */
export function createAlertList(container, { getAlerts } = {}) {
  let currentAlerts = [];

  container.innerHTML = `
    <section class="ts-card">
      <div class="ts-card-header">
        <div>
          <h2>Device C — Trail Alerts Feed</h2>
          <p class="ts-subtitle">Retrieved from Checkpoint via GET_ALERTS over Pear P2P</p>
        </div>
        <button type="button" id="ts-refresh-btn" class="ts-btn ts-btn-secondary">
          Retrieve Alerts (GET_ALERTS)
        </button>
      </div>

      <div class="ts-safety-banner">
        <strong>Trail Safety Notice:</strong> TrailSignal is an additional information channel, not a replacement for official trail warnings or emergency services. Every report is <strong>UNVERIFIED</strong>.
      </div>

      <div id="ts-sync-status" class="ts-sync-status">Not synced yet</div>
      <div id="ts-alerts-container" class="ts-reports-list"></div>
    </section>
  `;

  const refreshBtn = container.querySelector('#ts-refresh-btn');
  const syncStatusEl = container.querySelector('#ts-sync-status');
  const listEl = container.querySelector('#ts-alerts-container');

  function renderItems() {
    if (currentAlerts.length === 0) {
      listEl.innerHTML = `
        <div class="ts-empty">
          No alerts stored on checkpoint yet. Submit a report on Device A or click "Retrieve Alerts".
        </div>
      `;
      return;
    }

    const sorted = [...currentAlerts].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    listEl.innerHTML = sorted
      .map((alert) => {
        const id = alert.id || alert.reportId || 'unknown-id';
        const status = (alert.status || 'unverified').toUpperCase();
        const category = alert.category || 'unknown';
        const segment = alert.trailSegment || 'unknown';
        const rawTranscript = alert.rawTranscript || alert.rawText || alert.description || '';

        return `
          <article class="ts-report-item">
            <div class="ts-report-top">
              <div class="ts-report-badges">
                <span class="ts-badge ts-badge-unverified">
                  ⚠️ ${escapeHtml(status)}
                </span>
                <span class="ts-badge ts-badge-category">
                  Category: ${escapeHtml(category)}
                </span>
              </div>
              <time class="ts-report-time">${escapeHtml(formatTime(alert.createdAt))}</time>
            </div>

            <h3 class="ts-report-title">
              ${escapeHtml(alert.title || 'Unformatted Trail Report')}
            </h3>

            <div class="ts-report-segment">
              <strong>Trail Segment:</strong> ${escapeHtml(segment)}
            </div>

            <p class="ts-report-desc">
              ${escapeHtml(alert.description || rawTranscript)}
            </p>

            <div class="ts-report-raw">
              <strong>Original Spoken Transcript:</strong> "${escapeHtml(rawTranscript)}"
            </div>

            <div class="ts-report-meta">
              <span>Alert ID: ${escapeHtml(id)}</span>
            </div>
          </article>
        `;
      })
      .join('');
  }

  async function refresh() {
    refreshBtn.disabled = true;
    refreshBtn.textContent = 'Retrieving...';
    syncStatusEl.textContent = 'Requesting GET_ALERTS from checkpoint...';

    try {
      if (typeof getAlerts === 'function') {
        const res = await getAlerts();
        // Support both raw array return or { type: 'ALERTS', alerts: [...] } envelope
        currentAlerts = Array.isArray(res)
          ? res
          : Array.isArray(res?.alerts)
          ? res.alerts
          : [];
      }
      syncStatusEl.textContent = `Last retrieved: ${new Date().toLocaleTimeString()} (${currentAlerts.length} alert${currentAlerts.length === 1 ? '' : 's'})`;
      renderItems();
    } catch (err) {
      syncStatusEl.textContent = `Retrieval error: ${err.message}`;
    } finally {
      refreshBtn.disabled = false;
      refreshBtn.textContent = 'Retrieve Alerts (GET_ALERTS)';
    }
  }

  refreshBtn.addEventListener('click', refresh);

  return {
    refresh,
    setAlerts(alerts) {
      currentAlerts = Array.isArray(alerts) ? alerts : [];
      renderItems();
    }
  };
}