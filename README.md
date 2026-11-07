# TrailSignal

**Offline trail-safety alerts shared between hikers and trail checkpoints.**

TrailSignal is a small prototype for hikers in remote areas without internet access. A hiker speaks a hazard or assistance report; their device transcribes it locally, sends the text peer-to-peer to a trail checkpoint, and the checkpoint uses a local language model to turn it into a concise alert. A later hiker can connect to the checkpoint and retrieve the alert.

The MVP demonstrates one journey:

1. Hiker A records a short spoken report.
2. QVAC speech-to-text runs on Hiker A's device and produces a transcript.
3. Pear transfers the transcript to a checkpoint device.
4. Local QVAC validates the transcript and formats useful reports as concise structured alerts.
5. The checkpoint stores the alert after Hiker A disconnects.
6. Hiker B connects later and retrieves/displays the alert.

**No cloud service or external AI API is used for inference or report storage.** Models must be downloaded/cached before the offline demo.

---

## MVP scope

### Must work

- Record a short report with push-to-talk.
- Transcribe the recording locally with QVAC.
- Send the raw transcript from Hiker A to a checkpoint using Pear.
- Run a local QVAC text-generation model at the checkpoint to format the report.
- Store the alert on the checkpoint.
- Let a different hiker device connect later and retrieve stored alerts.
- Display the alert and a concise reported time.

### Three-device demo

Use three devices if possible:

- **Device A — Hiker:** records speech, runs local transcription, submits transcript.
- **Device B — Checkpoint:** receives transcript, runs local alert formatting, stores alerts, serves requests.
- **Device C — Hiker/viewer:** connects later and retrieves/displays stored alerts.

Keep the first demo narrow: one checkpoint, one shared trail/topic, one short English report, and a small set of fixed trail segments. Use push-to-talk and a short WAV recording; do not build live/streaming transcription unless everything else is already working.

If time is tight, allow a typed-text fallback on Device A. This preserves the P2P and checkpoint workflow if audio capture or transcription takes longer than expected.

> **Offline networking is the biggest early risk.** Hyperswarm uses HyperDHT peer discovery; joining the same topic does not by itself guarantee discovery in a completely isolated network. Prove the exact three-device connection with internet disabled before building the rest. If it does not work quickly, use a direct local-network transport supported by your Pear/Bare setup for the demo and describe the transport honestly. Do not claim internet-free operation until it has been tested with internet disabled.

---

## Architecture

```text
DEVICE A — HIKER                 DEVICE B — CHECKPOINT             DEVICE C — HIKER
      |                                   |                               |
 Push-to-talk recording                   |                               |
      |                                   |                               |
      v                                   |                               |
 QVAC speech-to-text                      |                               |
      |                                   |                               |
 Raw transcript                           |                               |
      |                                   |                               |
      +----------- Pear P2P -------------->+                               |
                                          |                               |
                                   QVAC local LLM                          |
                                   formats alert                           |
                                          |                               |
                                   Temporary alert store                   |
                                          |                               |
                                          +---------- Pear P2P ------------>
                                                                          |
                                                                   Alert list/UI
```

### Responsibilities

- **QVAC on Hiker A:** speech-to-text. The local test command also validates, formats, and stores a report for the single-device prototype.
- **Pear:** app/runtime and peer-to-peer transport between the hiker and checkpoint devices.
- **QVAC on the checkpoint:** turn the transcript into a short, readable, structured alert. It must not add facts that were not in the transcript.
- **Checkpoint:** store alerts and serve them to later visitors.
- **Hiker B:** retrieve and display alerts; no AI model is needed on this device.
- **Local storage:** use a simple JSON file for the prototype. A database or Hypercore integration is not required to prove the flow.

Keep AI and networking separate. The P2P layer should transport plain messages and alert objects; it should not depend on how the transcript or alert was generated.

---

## Message flow and protocol

Use one shared topic/room for the demo. Agree on the message names and JSON shapes before implementing the two sides.

### Hiker A → checkpoint

```json
{
  "type": "SUBMIT_REPORT",
  "reportId": "unique-id",
  "createdAt": "2026-11-07T12:00:00.000Z",
  "rawTranscript": "A landslide is blocking the path between Bridge 2 and the summit."
}
```

### Checkpoint → Hiker A

```json
{
  "type": "REPORT_RECEIVED",
  "reportId": "unique-id"
}
```

### Hiker B → checkpoint

```json
{
  "type": "GET_ALERTS"
}
```

### Checkpoint → Hiker B

```json
{
  "type": "ALERTS",
  "alerts": [
    {
      "id": "unique-id",
      "createdAt": "2026-11-07T12:00:00.000Z",
      "category": "landslide",
      "description": "A landslide is reported to be blocking the path between Bridge 2 and the summit.",
      "trailSegment": "Bridge 2 to Summit",
      "rawTranscript": "A landslide is blocking the path between Bridge 2 and the summit."
    }
  ]
}
```

The examples are illustrative; use the same schema in all modules. Keep the original transcript alongside the formatted alert so users can distinguish the source report from the model's summary.

### Alert rules

- The model formats and extracts; it does **not** decide whether a trail is safe.
- Never invent coordinates, exact locations, severity, injuries, verification, or emergency-service contact.
- Use `unknown` or omit a field when the speaker did not provide it.
- Keep the report timestamp available for ordering and grouping.
- Preserve the raw transcript for traceability.
- A local QVAC validation step discards clearly useless transcripts, such as conversational filler or unrelated text.
- If alert-formatting output is invalid, the formatter falls back to a minimal alert based on the raw transcript.

### Local speech-to-text test

The hiker-side transcription module accepts a short WAV file and
returns plain text using QVAC's local Parakeet model. The expected audio
format is 16 kHz, mono PCM WAV.

```bash
npm run ai:transcribe -- path/to/report.wav
```

The first run downloads and caches the speech model. Later runs use the
local cache and do not need internet access. This command only prints the
transcript; it does not store an alert.

To test directly with the Mac's default microphone:

```bash
npm run ai:talk
```

Press Enter to start speaking and Enter again to stop. The command uses
`ffmpeg` to save a temporary 16 kHz mono WAV file under
`data/recordings/`, then transcribes it locally. macOS may ask Terminal
or VS Code for microphone permission. It then validates, formats, and
stores the report locally.

Grouping is currently disabled. The checkpoint returns every stored
alert as a simple list. The grouping module remains available for a
later iteration.

---

## Team plan: two parallel workstreams, four people

### Workstream A — Pear P2P (2 people)

**Goal:** move a transcript from Hiker A to the checkpoint, retain it after disconnection, and serve it to Hiker B later.

**Person 1 — checkpoint peer**
1. Run the Pear app/runtime on the checkpoint device.
2. Join/listen on the agreed topic or local transport.
3. Receive `SUBMIT_REPORT`.
4. Pass the transcript to the checkpoint AI function.
5. Store the resulting alert in a local JSON file.
6. Handle `GET_ALERTS` and return the stored alert list.

**Person 2 — hiker peer**
1. Run the Pear app/runtime on Hiker A and Hiker B devices.
2. Connect to the checkpoint using the agreed topic/transport.
3. Send `SUBMIT_REPORT` from Hiker A.
4. Show a receipt/acknowledgement.
5. From Hiker B, send `GET_ALERTS` and render the returned list.

Suggested module boundary:

```js
await submitTranscript({ reportId, createdAt, rawTranscript });
const alerts = await getAlerts();
```

Keep the public interface small. The AI/UI work should not need to know the networking implementation.

### Workstream B — Local AI with QVAC (2 people)

**Person 3 — Hiker A transcription**
1. Get the QVAC runtime and a supported speech-to-text model running on the actual device.
2. Implement push-to-talk audio capture.
3. Convert the recording to the format expected by the model (follow the model/runtime requirements; the QVAC Whisper example uses 16 kHz mono WAV).
4. Run local transcription and return plain text.
5. Add a typed-text fallback in case audio capture/model setup fails.

Suggested module boundary:

```js
const rawTranscript = await transcribeRecording(audioFile);
```

**Person 4 — Checkpoint alert formatting**
1. Get a QVAC text-generation model running locally on the checkpoint.
2. Implement `formatAlert(rawTranscript)`.
3. Add a local-QVAC usefulness check to reject clearly useless transcripts.
4. Prompt the model to return only the agreed alert fields.
5. Parse and validate its output; do not trust generated JSON blindly.
6. Keep the output concise and preserve the original transcript.
7. Fall back to a minimal raw-transcript alert if formatting fails.

Suggested module boundary:

```js
const alert = await formatAlert(rawTranscript);
```

A small model and short prompt are sufficient. Do not spend the hackathon tuning model quality; a reliable local inference call is the goal.

---

## Integration contract

Agree on these functions and fields immediately:

```js
// Hiker A: local QVAC transcription
const rawTranscript = await transcribeRecording(audioFile);

// Hiker A: Pear sends the transcript to the checkpoint
await submitTranscript({
  reportId,
  createdAt: new Date().toISOString(),
  rawTranscript
});

// Checkpoint: local QVAC formatting
const alert = await formatAlert(rawTranscript);

// Checkpoint: persist alert
await saveAlert(alert);

// Hiker B: Pear retrieves checkpoint alerts
const alerts = await getAlerts();
```

The checkpoint should create or retain the report ID and timestamp from the incoming message. The formatter should return `category`, `description`, and `trailSegment`; application code should attach the original transcript.

**Fallbacks that keep the demo moving:**
- If transcription is not ready, type the report on Hiker A.
- If checkpoint LLM is not ready, store/display the raw transcript as a minimal alert.
- If P2P is not ready, test AI functions independently with a sample transcript.
- Do not block the end-to-end demo on a sophisticated database or UI.

---

## Suggested repository layout

Adapt this to the official starter rather than rewriting its structure:

```text
trailsignal/
├── README.md
├── src/
│   ├── app.js
│   ├── messages.js
│   ├── ai/
│   │   ├── transcribe.js
│   │   └── format-alert.js
│   ├── p2p/
│   │   ├── peer.js
│   │   └── checkpoint-store.js
│   └── ui/
│       ├── record-report.js
│       └── alert-list.js
└── test/
    ├── sample-transcripts.json
    └── integration-checklist.md
```

Official starting point: [hello-pear-qvac-tui](https://github.com/holepunchto/hello-pear-qvac-tui).

Useful documentation:
- [QVAC documentation](https://docs.qvac.tether.io/)
- [QVAC ecosystem](https://docs.qvac.tether.io/ecosystem/)
- [Pear documentation](https://docs.pears.com/)
- [Pear P2P documentation](https://docs.pears.com/p2p/)

**Version caution:** the existing Pear/QVAC starter may pin an older QVAC package/API than the current QVAC SDK documentation. Inspect the starter's `package.json` and working example before copying code. Do not mix APIs from different SDK versions. Keep the starter's working dependency versions unless you have time to upgrade and retest.

---

## Three-hour build schedule

| Time | P2P pair | QVAC pair | Integration target |
|---|---|---|---|
| 0–30 min | Run Pear starter; prove two peers exchange `hello` with internet disabled | Run local transcription and local text generation independently; start model downloads/caching | Decide transport and freeze message schema |
| 30–75 min | Implement submit, receive, fetch, and checkpoint JSON storage | Person 3 gets recording → transcript; Person 4 gets transcript → alert JSON | Each module exposes its agreed function |
| 75–120 min | Connect Hiker A → checkpoint and Hiker B → checkpoint | Connect transcription and formatting to app flow | Complete transcript → checkpoint → stored alert → viewer |
| 120–150 min | Fix reconnect/retrieval and visible connection state | Add invalid-output fallback and preserve raw transcript | Basic three-device UI |
| 150–180 min | Run full demo with internet off | Verify both models run locally with internet off | Rehearse twice; freeze features |

**Hard stop:** if the chosen P2P discovery path has not passed the internet-disabled device test in the first 30 minutes, switch to a transport that works on the demo network. Do not spend the full hackathon debugging peer discovery.

---

## Demo checklist

- [ ] Models are downloaded/cached on the relevant devices before going offline.
- [ ] Internet is disabled on all demo devices.
- [ ] Hiker A can record a short spoken report.
- [ ] QVAC transcribes it locally.
- [ ] Hiker A sends the transcript to the checkpoint.
- [ ] The checkpoint acknowledges receipt.
- [ ] Checkpoint QVAC formats the transcript locally.
- [ ] The checkpoint stores the alert.
- [ ] Hiker A disconnects.
- [ ] Hiker B connects afterwards and retrieves the stored alert.
- [ ] The alert displays a concise reported time.
- [ ] The raw transcript remains available.
- [ ] The typed-report and raw-transcript fallbacks work.

### 60-second demo story

1. "We're hiking somewhere with no internet."
2. Hiker A says: "A landslide is blocking the path between Bridge 2 and the summit."
3. Show local QVAC transcription on Hiker A.
4. Send the transcript peer-to-peer to the checkpoint.
5. Show the checkpoint's local QVAC model formatting and storing the alert.
6. Disconnect Hiker A.
7. Connect Hiker B and retrieve the alert.
8. Show the original report, concise alert, date and time.

---

## Out of scope

- AI deciding whether a route is safe or recommending that someone proceed.
- Automatic report verification or moderation.
- Emergency dispatch, rescue coordination, or claims that emergency services were contacted.
- GPS navigation, downloadable maps, or automatic location inference.
- Live/streaming speech transcription.
- Image/video analysis.
- Multiple checkpoints, mesh routing, or complex store-carry-forward.
- Accounts, central administration, cloud sync, or a production-grade database.
- Conflict resolution, reputation scoring, and sophisticated anti-spam systems.

TrailSignal is an additional information channel, not a replacement for official trail warnings, emergency services, or established safety procedures. Reports may be incomplete, mistaken, delayed, or unverified; hikers must use their own judgement and follow official guidance.