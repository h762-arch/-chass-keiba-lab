# Phase120: Drive research Snapshot preparation, immutable save and reconnect

Base: 7218f6cdc791ec34b22d7ab4ab09c40000ce2ae9 (merged PR180).

This Node-only module orchestrates the Phase119 identity/date resolver and the
existing research Snapshot bridge. It does not add app routes, runtime flags,
Drive OAuth, network access, D1/R2 writes, model adoption or Signal generation.

## APIs

`prepareJraDriveSnapshotArtifact({environment:'QUARANTINE',resolutionInput,
snapshotContext})` detaches JSON inputs and invokes the resolver. snapshotContext
requires an explicit safe runId and modelVersion. For a resolved field, source,
cutoffAt and offAt must satisfy the existing Snapshot bridge. The source
spreadsheetId must match the PDF authority. Context cannot override resolved
race/runner/history/identity tables. No availability or cutoff timestamp is
generated. All authentication/timing declarations remain unverified.

If resolution is HOLD, the artifact has status RESOLUTION_HOLD, retains inputs
and resolution diagnostics, and snapshot is null. If the field is resolved,
the status is SNAPSHOT_PREPARED with a market-independent research Snapshot.
Neither status is a formal EARLY/KPI/production adoption verdict. All promotion
flags remain false and freezeMutation is NONE. Stored raw exports may include
source-market columns for replay; these do not enter the Snapshot DATA tables.

`persistJraDriveSnapshotQuarantine({root,...prepareArguments})` requires an
existing absolute directory explicitly owned and isolated by the operator.
Environment/namespace strings do not authenticate filesystem isolation. The
directory must not be writable by untrusted concurrent actors. Artifact JSON
is bounded to 300000 bytes, depth 40. Its filename is SHA256 of run/race/model
identity. A mode-0600 temporary file is linked atomically to its final filename
without replacing an existing file; temporary files are cleaned up. An
identical replay returns EXISTING_IDENTICAL; different evidence for the same
identity returns QUARANTINE_IMMUTABLE_CONFLICT without overwriting the original.
Use a new explicit runId for a later acquisition, keeping the original evidence.

The saved `anchor` binds schema/environment/run/race/model/size/SHA256. Retain it
independently outside the evidence directory, then use
`readJraDriveSnapshotQuarantine({root,environment:'QUARANTINE',anchor})` in a
separate process. Reconnect refuses final-file symlinks, reads bounded bytes,
checks size/hash/identity, reruns resolution/Snapshot preparation from retained
inputs, and requires exact canonical output equality. This proves consistency
against the retained anchor, not external source authenticity. Reconnect does
no file write and does not acquire sources again. READBACK_VERIFIED can describe
a verified HOLD artifact and must never be interpreted as prediction success.

Published-but-unverified outcomes return persisted:null and the anchor; use an
explicit later readback to resolve them. This local filesystem path has no
fsync/power-loss durability guarantee, remote retention guarantee or R2 proof.
It requires a new independent operational validation before remote use.

## Validation

11 new synthetic tests cover confirmed Snapshot creation, HOLD persistence,
separate Node-process reconnect, duplicate/conflicting/concurrent publication,
tampering, replay rejection even with a newly supplied hash, foreign anchor
identity/size, symlinks, bounds, source/cutoff and context override rejection.
Full local repository check: 1706 tests PASS, 0 failures (Chromium included).

Fresh read-only Drive inspection on 2026-10-11 used the date-specific source:
JRA_PDF_MANIFEST A1:Q2, JRA_RACE_RUNNER A1:Y16, JRA_HISTORY A1:AI76. Tokyo1R has
15 runners/75 slots. Native master map headers and sampled rows A1:M4/A1:L4
were supplied as a bounded partial export. No matching target race was present,
so the real artifact remained RESOLUTION_HOLD / snapshot:null, reason
PDF_RACE_MAP_UNCONFIRMED_OR_CONFLICT. Saving and reconnect from a separate Node
process succeeded locally. No real confirmed Snapshot was generated.

An additional bounded search covering the current race-map grid A1:M2000 for
20261011_東京_1 returned 0 rows. Horse-map source-key column C1:C5000 for
TEMP|ステラガーネット|牝2 also returned 0 rows. These observations are limited
to those exact sheets/ranges/values and do not prove absence in other sources.
No map/status/year proof was fabricated or written to the master. The late
audit run has no claimed pre-off source availability and is not a new EARLY run.

Sources:
- https://github.com/h762-arch/-chass-keiba-lab/pull/180
- https://docs.google.com/spreadsheets/d/1dqFySEgG6cYEXIx8BmOw7tPOe7wI90H_No1FRoXlgoI/edit
- https://docs.google.com/spreadsheets/d/1t6dIEcq7Ug3h6ScHEeKudGyx5FIZ-tVqvhAKxp8BBy8/edit

Next: connect independently retained confirmed race/horse mappings, official
starter-state and full-year history evidence; produce and reconnect a real
research Snapshot. App auto-sync and production reader remain unconnected.
Existing Original EARLY, marks, diamonds/warnings and formal KPI are unchanged.
