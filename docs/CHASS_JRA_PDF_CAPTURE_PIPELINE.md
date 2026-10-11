# Phase123: explicit JRA PDF capture pipeline

This Node research module connects the Phase122 bounded official-card capture
and exact PDF evidence builder to Phase120 quarantine persistence/readback.
It adds no public app route, Worker/Cron job, Drive OAuth, production D1 write,
market/Signal generation, or formal EARLY adoption.

## Explicit invocation

```js
import {runJraPdfCapturePipeline, readJraPdfCaptureAttempt}
  from './src/research/jra-pdf-capture-pipeline-v1.mjs';
const result = await runJraPdfCapturePipeline({
  environment: 'QUARANTINE',
  root: '/absolute/existing/attempt-directory',
  snapshotRoot: '/absolute/existing/snapshot-directory',
  attemptId: 'explicit-unique-attempt',
  pdfInput, snapshotContext, sourceUrl
});
```

Supply a bounded connector export and explicit run/model identity. Both isolated
roots must already exist. Inputs are copied before any await. The source fetch
is the Phase122 single request, limited to 10 seconds and 1 MB. These limits
cover network capture, not the subsequent filesystem operations.

Attempt records contain run/race/model/attempt identity, process attemptedAt,
PDF input hash, exact capture receipt when available, outcome and a sanitized
reason. Raw error messages, response bodies and credentials are never copied
into failure records. The receipt is a process observation, not authenticated
historical timing. Capture failure does not manufacture an ACTIVE state or
reuse an old Snapshot.

| Outcome | Meaning |
| --- | --- |
| CAPTURE_HOLD | Capture or card/PDF validation failed; fixed reason recorded |
| RESOLUTION_HOLD | Evidence saved and replayed; unresolved items remain; Snapshot null |
| SNAPSHOT_HOLD | Timing, preparation or Snapshot save failed |
| SNAPSHOT_SAVED | Unverified research Snapshot saved and replayed |

`readbackVerified` refers to record integrity, not successful prediction or
formal eligibility. Always inspect `attempt.outcome` and the resolution failures
inside `snapshotReadback.artifact`. The flags formalKpiEligible, adopted and
productionActivationReady are always false.

## Timing and immutable persistence

For a prepared Snapshot, observation must be at or before cutoff, cutoff must
be before off, the caller's off must equal the parsed official off, and combined
source availableAt must be no earlier than official observation. Phase120 also
validates source export/availability and source spreadsheet identity. Do not
backdate metadata to force a pre-off Snapshot. A post-off card is retained as
RESOLUTION_HOLD, without restoring historical starter-state proof.

Attempt files are private (0600), size bounded, canonical JSON, hashed and
conditionally published with a hard link. A pre-existing attempt identity is
rejected before another fetch or Snapshot write. Use a new explicit attempt ID
for a retry; read an existing attempt using its independently retained anchor.
Publication races cannot overwrite an existing file. Record readback uses
NOFOLLOW, bounded reads, hash/identity checks and fixed eligibility flags.
Snapshot anchors and resolution/context hashes are bound to the attempt and
replayed through Phase120 without network access.

The two files are not a transaction: a process crash or failed attempt write
may leave a Snapshot artifact without its attempt file. A reported attempt
save failure returns snapshotAnchor when a verified child was already saved.
Retain returned anchors independently, inspect any partial save, and never
interpret persisted:null or readbackVerified:false as success.

Receipt checks and Snapshot replay do not re-download/re-parse the original
HTML. Keep source capture material independently for source-level audits;
process receipts and hashes alone cannot establish source authentication.

## Verification

New regression tests cover the complete synthetic pre-off success path,
post-off HOLD, durable HTTP/deadline reasons, private error sanitization,
cutoff/off/source-availability mismatch, separate-process reconnect,
immutable attempts, Snapshot conflict, input mutation, file/child tampering,
flag forgery, symlinks, invalid roots/IDs/size and concurrent publication.

Live test: 2026-10-12 07:19:20 JST, official Tokyo 1R card for 2026-10-11.
164,760 Shift_JIS bytes received; 15 exact horse ID joins, 21 dated histories,
54 source-empty slots. The pipeline saved RESOLUTION_HOLD with 15
PDF_RUNNER_STATUS_UNCONFIRMED entries and no Snapshot, because capture was
post-off. Attempt and child evidence reconnect in a separate Node process.

Formal EARLY and Production Activation remain on hold. Public app integration
and connected Drive writes are not part of this patch.
