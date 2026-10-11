# Phase124: explicit capture/replay command and retained receipt

The command exposes the Phase123 Node research pipeline for bounded connector
exports. It does not add an app/Worker/Cron route, Drive OAuth or connected
Drive write, production database write, automatic Signal generation or EARLY
adoption. Public app behavior is unchanged.

## Input and commands

Prepare an input JSON object with only these fields:

- environment: exactly QUARANTINE
- attemptId: a unique explicit ID for this attempt
- pdfInput: the Phase118 connector-export tables and exact race identity
- snapshotContext: explicit runId, modelVersion, cutoffAt, offAt and source metadata
- sourceUrl: the exact JRA official card URL
- optional timeoutMs and maxBytes, within Phase122 limits

Use absolute paths. Create isolated attempt/Snapshot directories beforehand.
The command reads up to 300,000 bytes of valid UTF-8 JSON and never follows an
input-file symlink. Inputs supplied through JSON cannot inject fetch, clock,
root or stdout controls. Fetch/clock injection is available only to imported
unit-test code.

```sh
node scripts/jra-pdf-capture-cli.mjs capture \
  --input /absolute/input.json \
  --attempt-root /absolute/attempts \
  --snapshot-root /absolute/snapshots \
  --receipt /absolute/retained-receipt.json

node scripts/jra-pdf-capture-cli.mjs replay \
  --attempt-root /absolute/attempts \
  --snapshot-root /absolute/snapshots \
  --receipt /absolute/retained-receipt.json
```

The retained receipt contains an independent attempt anchor and a small summary:
identity, outcome/reason, capture process receipt, counts, resolution reason
counts, snapshotSaved and fixed research-only flags. Unknown counts are null,
not zero. It includes no source tables, horse names or raw exception text.
Protect this receipt independently from the attempt/Snapshot directories.

A receipt is written privately (0600), conditionally published without replacing
an existing file, then read back and compared with the verified attempt and
child Snapshot. An existing receipt blocks capture before any network request.
Use a new receipt path and explicit attempt ID for a new attempt. Races cannot
replace a receipt; failed publication returns a recovery anchor on stdout if
the attempt was already saved. A recovery anchor is not itself proof that a
receipt file was successfully written.

Replay reads at most 64,000 receipt bytes, refuses file symlinks and re-verifies
saved evidence through Phase123/120 without fetching again. It derives the
summary from saved evidence; modified outcomes, eligibility flags or counts do
not pass by editing only the receipt. It neither creates nor updates files.
Source authenticity and process timing remain UNVERIFIED. Replay verifies
stored evidence, not the original HTML extraction.

## Exit codes and result interpretation

| Exit | Meaning |
| --- | --- |
| 0 | Unverified research Snapshot saved/replayed; formal eligibility still false |
| 2 | Invalid command, input, receipt, location or failed replay validation |
| 3 | Verified receipt/attempt with CAPTURE_HOLD, RESOLUTION_HOLD or SNAPSHOT_HOLD |
| 4 | Pipeline or receipt save/readback failed; inspect recovery anchor when present |

Stdout is one JSON result. Stderr contains only a fixed reason code for thrown
CLI errors. Never treat a saved HOLD receipt or zero exit as authorization for
Production Activation. Snapshot save and receipt publication are separate
operations, not a transaction; preserve returned anchors when publication fails.
A resolution reason must be checked even when the journal readback succeeded.

## Validation

Fourteen new tests cover success/HOLD exit distinction, durable sanitized
capture failure, separate-process replay, no network on replay, immutable
receipts, edited counts/anchors, argument validation, size and symlink bounds,
production/control injection, missing roots, publication races and recovery
anchor output. Related PDF/quarantine suite: 94/94 PASS.

The live CLI audit uses the existing 2026-10-11 Tokyo 1R connector export, not
new pre-off data. Any post-off capture must remain HOLD without a prediction
Snapshot. Synthetic pre-off tests establish executable wiring only; they do
not establish formal EARLY eligibility or app/Drive integration.

Live capture at 2026-10-12 07:31:45 JST returned RESOLUTION_HOLD with
15 horse ID joins, 21 dated histories, 54 source-empty slots and 15
PDF_RUNNER_STATUS_UNCONFIRMED entries. Receipt publication/readback and
separate-process replay both succeeded and returned exit 3, with snapshotSaved
false. Full repository check: 1,763/1,763 PASS.
