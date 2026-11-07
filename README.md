# TrailSignal

**Offline trail-safety reports shared between hikers and trail
checkpoints.**

TrailSignal lets hikers report hazards when there is no internet
connection. A nearby checkpoint stores those reports and shares them
with later hikers who connect to it.

The MVP proves one simple journey:

1.  Hiker A creates a report on their device.
2.  The report is sent peer-to-peer to a checkpoint device.
3.  The checkpoint keeps the report after Hiker A disconnects.
4.  Hiker B connects later and receives the report.

QVAC runs locally to turn a short free-text report into structured
information. Pear provides the app/runtime and peer-to-peer foundation.
**No cloud service or external AI API is used in the MVP.**

------------------------------------------------------------------------

## MVP scope

### Must work

-   Create a trail report from text.
-   Use a locally running QVAC model to extract structured fields.
-   Send the report from a hiker device to a checkpoint over a local,
    internet-free connection.
-   Store the report on the checkpoint.
-   Let a different hiker device connect later and retrieve stored
    reports.
-   Display report type, location/segment, description, time and status.

### Keep it simple

For the first demo, use **one checkpoint and two hiker devices**. Use
text input and a small set of fixed trail segments. Start with a local
Wi-Fi network/hotspot with internet disabled, provided the chosen Pear
transport works in that setup.

Do not build mobile BLE, maps, accounts, notifications, image analysis,
voice transcription, multi-checkpoint routing or complex conflict
resolution yet.

> Important: verify the exact Pear networking/discovery setup on the
> demo machines early. Peer-to-peer libraries do not automatically
> guarantee discovery on an isolated network. Do not claim the system
> works fully offline until the two-device test succeeds with internet
> disabled.

------------------------------------------------------------------------

## Architecture

``` text
Hiker A app                         Hiker B app
  |                                    |
  | report text                        | connect later
  v                                    v
Local QVAC model                    Peer client
  |                                    |
  | structured report                  | fetch reports
  v                                    |
Pear peer connection <----------> Checkpoint device
                                      |
                                      v
                                Local report store
```

### Responsibilities

-   **QVAC:** local text-to-structured-report extraction. The model must
    be downloaded/cached before the offline demo.
-   **Pear:** app runtime and peer-to-peer communication.
-   **Checkpoint:** receives, stores and serves reports. It must retain
    reports when the reporting hiker disconnects.
-   **Local storage:** persist reports on the checkpoint; a simple local
    JSON/Hyperbee-backed store is enough for the MVP.

Keep AI processing and networking separate. The networking code should
send and receive the agreed report object; it should not depend on how
QVAC produced it.

------------------------------------------------------------------------

## Shared report format

Both workstreams should use this shape from the beginning:

``` json
{
  "id": "unique-report-id",
  "createdAt": "2026-11-07T12:00:00.000Z",
  "type": "trail_hazard",
  "category": "landslide",
  "title": "Path blocked by landslide",
  "description": "Rocks and mud are blocking the path.",
  "trailSegment": "Bridge 2 to Summit",
  "status": "unverified",
  "source": "hiker-device"
}
```

For the MVP, `type` can be `trail_hazard` or `assistance_request`. Keep
`status` simple: `unverified`, `verified`, or `resolved`.

The original user-entered text should also be retained for traceability.
Do not let the model invent coordinates, verification, or
emergency-service contact.

------------------------------------------------------------------------

## Team plan: two parallel workstreams

### Workstream A --- Peer-to-peer communication (2 people)

**Goal:** prove that reports can move from one hiker device to a
checkpoint, remain there, and be retrieved by another hiker device with
internet disabled.

Tasks:

1.  Get the Pear starter/runtime running on the target machines.
2.  Build the smallest possible peer connection test: connect two peers
    and exchange a plain text message.
3.  Test the connection with internet disabled using the intended local
    network.
4.  Implement `sendReport(report)` from hiker to checkpoint.
5.  Implement checkpoint persistence.
6.  Implement `getReports()` for a newly connected hiker.
7.  Add a basic connection status and useful error messages.

Suggested module boundary:

``` js
// P2P module contract — adapt the implementation to the chosen Pear transport.
await sendReport(report);
const reports = await getReports();
```

The P2P team owns connection setup, transport, checkpoint storage and
report retrieval. Keep the public interface small so the AI/UI work can
integrate without knowing networking internals.

### Workstream B --- Local LLM / QVAC (2 people)

**Goal:** get QVAC inference running locally on the actual demo machines
and convert a hiker's text into the shared report format.

Tasks:

1.  Clone and run the official QVAC + Pear starter.
2.  Download/cache the model while internet is available.
3.  Confirm inference works locally after disconnecting from the
    internet.
4.  Create a prompt that extracts the shared report fields as JSON.
5.  Parse and validate the model output.
6.  Add a safe fallback if the model returns invalid JSON.
7.  Expose a small function for the app to call.

Suggested module boundary:

``` js
// AI module contract
const reportFields = await extractReport(userText);
```

The AI team owns model loading, prompting, parsing and validation. It
should return structured data, not send network messages or write
directly to the checkpoint store.

### Integration contract

Agree on these interfaces before parallel work begins:

``` js
// AI
const reportFields = await extractReport(userText);

// App adds metadata and a unique ID
const report = {
  id,
  createdAt: new Date().toISOString(),
  ...reportFields,
  source: deviceId
};

// P2P
await sendReport(report);

// On a later connection
const reports = await getReports();
```

If QVAC is not ready, the app should temporarily use a hard-coded report
object so the P2P team can continue. If P2P is not ready, the AI team
should save extracted reports locally. This lets both teams make
progress independently.

------------------------------------------------------------------------

## Suggested repository layout

Adapt this to the official starter rather than rewriting its structure:

``` text
trailsignal/
├── README.md
├── src/
│   ├── app.js
│   ├── report-schema.js
│   ├── ai/
│   │   └── extract-report.js
│   ├── p2p/
│   │   ├── peer.js
│   │   └── checkpoint-store.js
│   └── ui/
│       ├── report-form.js
│       └── report-list.js
└── test/
    ├── sample-reports.json
    └── integration-checklist.md
```

Official starting point:
[hello-pear-qvac-tui](https://github.com/holepunchto/hello-pear-qvac-tui).

Useful documentation: - [QVAC
documentation](https://docs.qvac.tether.io/) - [QVAC
ecosystem](https://docs.qvac.tether.io/ecosystem/) - [Pear
documentation](https://docs.pears.com/) - [Pear P2P
documentation](https://docs.pears.com/p2p/)

------------------------------------------------------------------------

## 12-hour build schedule

  -----------------------------------------------------------------------
  Time                    Peer-to-peer team       QVAC team
  ----------------------- ----------------------- -----------------------
  0--1 h                  Run Pear starter; test  Run QVAC starter; cache
                          local peer connection   model

  1--3 h                  Exchange a plain text   Extract JSON from
                          message                 sample report

  3--5 h                  Send/store/retrieve     Validate output and
                          report                  fallback

  5--7 h                  Test a second hiker     Integrate extraction
                          connecting later        with app

  7--9 h                  Fix offline connection  Test local inference
                          and persistence         offline

  9--10 h                 Integrate and debug     Integrate and debug

  10--12 h                End-to-end testing      Demo preparation and
                                                  backup
  -----------------------------------------------------------------------

**Integration checkpoints:** at hour 2, both teams demonstrate their
smallest working component; at hour 5, agree the report object is
flowing between modules; at hour 9, freeze features and test the
complete flow.

------------------------------------------------------------------------

## Demo checklist

-   [ ] QVAC model is already cached on the demo machines.
-   [ ] Internet is disabled on all devices.
-   [ ] Hiker A can create a report.
-   [ ] QVAC converts the text into the shared report structure.
-   [ ] Hiker A sends the report to the checkpoint.
-   [ ] Hiker A disconnects.
-   [ ] Hiker B connects afterwards.
-   [ ] Hiker B retrieves and sees the stored report.
-   [ ] The report clearly says it is unverified and shows its
    timestamp.

### 60-second demo story

1.  "We're hiking with no internet."
2.  Hiker A reports: "A landslide blocks the path between Bridge 2 and
    the summit."
3.  Show QVAC extracting the report locally.
4.  Send it to the checkpoint.
5.  Disconnect Hiker A.
6.  Connect Hiker B and retrieve the report.
7.  Show the warning before Hiker B continues.

------------------------------------------------------------------------

## Out of scope for the MVP

-   Automatic emergency dispatch or rescue coordination.
-   AI deciding whether a route is safe.
-   Automatic verification of reports.
-   GPS navigation or downloadable maps.
-   Voice/image input.
-   Multiple checkpoint routing and store-carry-forward between
    checkpoints.
-   User accounts and central administration.

TrailSignal is an additional information channel, not a replacement for
official trail warnings, emergency services or established safety
procedures.
