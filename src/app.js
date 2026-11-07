// src/app.js
import { initTrailSignalUI } from './ui/index.js';
// When ready, uncomment your teammates' modules:
// import { transcribeRecording } from './ai/transcribe.js';
// import { formatAlert } from './ai/format-alert.js';
// import { submitTranscript, getAlerts } from './p2p/peer.js';

const STORAGE_KEY = 'trailsignal_checkpoint_alerts_v2';

function loadMockAlerts() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return [
    {
      id: 'unique-id',
      createdAt: '2026-11-07T12:00:00.000Z',
      category: 'landslide',
      title: 'Landslide reported near Bridge 2',
      description: 'A landslide is reported to be blocking the path between Bridge 2 and the summit.',
      trailSegment: 'Bridge 2 to Summit',
      status: 'unverified',
      rawTranscript: 'A landslide is blocking the path between Bridge 2 and the summit.'
    }
  ];
}

let ui = null;

// Person 3 mock: Hiker A local QVAC speech-to-text
const mockTranscribeRecording = async (_audioBlobOrNull) => {
  await new Promise((r) => setTimeout(r, 700));
  return 'A landslide is blocking the path between Bridge 2 and the summit.';
};

// Person 4 mock: Checkpoint local QVAC alert formatting
const mockFormatAlert = async (rawTranscript) => {
  await new Promise((r) => setTimeout(r, 600));
  const lower = rawTranscript.toLowerCase();
  const category = lower.includes('landslide')
    ? 'landslide'
    : lower.includes('tree')
    ? 'fallen_tree'
    : lower.includes('help') || lower.includes('injured')
    ? 'assistance'
    : 'hazard';

  let trailSegment = 'unknown';
  if (lower.includes('bridge 2') && lower.includes('summit')) {
    trailSegment = 'Bridge 2 to Summit';
  } else if (lower.includes('bridge 1')) {
    trailSegment = 'Trailhead to Bridge 1';
  }

  return {
    category,
    title: category === 'landslide' ? 'Landslide reported on trail' : `Trail ${category} reported`,
    description: rawTranscript,
    trailSegment,
    status: 'unverified'
  };
};

// Person 2 & Person 1 mock: Hiker A -> Checkpoint SUBMIT_REPORT -> REPORT_RECEIVED
const mockSubmitTranscript = async ({ reportId, createdAt, rawTranscript }) => {
  if (ui) {
    ui.logCheckpointEvent({
      stage: 'Received SUBMIT_REPORT — formatting with Checkpoint QVAC...',
      reportId,
      rawTranscript
    });
  }

  let formatted;
  try {
    formatted = await mockFormatAlert(rawTranscript);
  } catch (err) {
    // README rule: fallback to storing raw transcript if generation fails
    formatted = {
      category: 'unknown',
      title: 'Unformatted Trail Report',
      description: rawTranscript,
      trailSegment: 'unknown',
      status: 'unverified'
    };
  }

  const storedAlert = {
    id: reportId,
    createdAt,
    category: formatted.category || 'unknown',
    title: formatted.title || 'Trail Alert',
    description: formatted.description || rawTranscript,
    trailSegment: formatted.trailSegment || 'unknown',
    status: 'unverified', // Forced in application code per README
    rawTranscript
  };

  const alerts = loadMockAlerts();
  alerts.push(storedAlert);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(alerts));

  if (ui) {
    ui.logCheckpointEvent({
      stage: 'Alert formatted by QVAC & stored in Checkpoint JSON',
      reportId,
      rawTranscript,
      formattedAlert: storedAlert
    });
  }

  // Return Checkpoint -> Hiker A receipt acknowledgement
  return {
    type: 'REPORT_RECEIVED',
    reportId
  };
};

// Person 2 mock: Hiker B -> Checkpoint GET_ALERTS -> ALERTS
const mockGetAlerts = async () => {
  await new Promise((r) => setTimeout(r, 250));
  return loadMockAlerts();
};

const root = document.getElementById('app') || document.body;

ui = initTrailSignalUI(root, {
  transcribeRecording: mockTranscribeRecording,
  submitTranscript: mockSubmitTranscript,
  getAlerts: mockGetAlerts
});

// Expose `window.trailSignalUI` so P2P or Checkpoint scripts can call hooks from anywhere:
// e.g. window.trailSignalUI.setConnectionStatus('connected')
window.trailSignalUI = ui;