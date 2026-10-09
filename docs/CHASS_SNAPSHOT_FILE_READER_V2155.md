# Phase94: preregistered source-snapshot file reader

Expected main: 9a8e7ff3b7f5552403f733fb2402f3faa5acb0c8 (PR160).
Verified source tree: fea2f10c5a2baee1af6b93db6fed4a020f7f7490.
Local baseline is reconstructed from exact reviewed patches and has this identical
tree; no fabricated upstream commit. Policy: v2.15.5 Acquisition-First / CONTRACT_V04.
https://docs.google.com/document/d/1VivM-SpbiyKwJENk58wWlGdeBqGO0L1iapWXw4KQHhk/edit

## Concrete reader

`createPredictionSnapshotFileReadersV2155({root,environment,bindings})` creates
1..4 registered Node file reader functions for Phase92/93. Each binding supplies
readerId, sourceRef, planHash, relativePath, expectedSha256 and expectedBytes
(1..50000). Caller supplies these from independently retained preregistration;
this module never computes an expected hash at runtime to bless an unknown file.
QUARANTINE and a dedicated trusted absolute source root are required.

An actual read opens the file read-only, checks regular-file size, bounded reads,
post-read size/mtime stability and exact raw-byte SHA256. Root unavailability is
CONFLICT (configuration failure); absence of an actual registered source file is
NOT_FOUND. Content mismatch, invalid JSON, identity/provenance mismatch, path
escape, leaf symlink or other invalid read returns CONFLICT and Phase90 HOLD.
No exceptions expose private paths or error details. No retry is added.

Paths are relative and cannot contain dot/dotdot/empty components, backslashes or
an absolute path. Realpath must stay beneath real source root, and O_NOFOLLOW
rejects leaf links. A malicious concurrent writer can race path resolution or
metadata checks; roots must be trusted and isolated, not attacker-controlled.
This is not an OS sandbox or source authentication mechanism.

Source file JSON is a normalized sourceSnapshot envelope: sourceRef,
sourceSnapshotId, runId/raceId/eligibilityId/fieldId/scopeKey, sourceStage,
identityStatus/sourceLineage/leakageGuard, capturedAt/dataAsOf/value and non-null
payload. It must already contain identity/lineage/leakage PASS and EARLY, and
exact IDs for the executor context. No PASS, source value or source time is
manufactured. File mtime is never a substitute for capturedAt/DataAsOf. Phase90
still validates actual pre-cutoff observation, timestamps and numeric values.

The returned FOUND receipt is drawn from those existing metadata fields. The
retained snapshot adds explicitly observed fileReadEvidence: byteSha256,
byteCount, rawGzip=false, rawBase64. Exact original bytes remain reconstructible
and hash-verifiable after Phase93 atomic save and reconnect. Source payload and
value extraction correctness remain the producing adapter's responsibility.
Phase93 independently enforces its 200k response/300k document size limits;
oversized evidence fails closed, without truncation or a false save receipt.

Bindings are copied/frozen. Readers observe AbortSignal before and between file
operations; OS operations already underway cannot be forcefully cancelled.
Phase90 observes cutoff and holds on timeout, and Phase93 rejects late capture.
No source file is modified. No writable reader, network/Drive/D1 access, source
credential handling, scheduler, Worker route or formal KPI adoption is introduced.

## Validation and limits

13 synthetic tests use actual temporary file I/O, exact raw-byte persistence and
reconnect, missing sources, hash/size changes, foreign identity, missing time,
symlink/escape, path/binding setup rejection, abort/foreign plan, malformed/POST
sources, input mutation/read-only behavior and unavailable source root.
Related Phase88-93 tests run alongside them. Full-check totals are separately
reported in audit logs.

This implements a concrete local snapshot reader, not an authenticated live
provider or a real race registration. Honest, externally verified Source Registry,
Identity, Availability, frozen contract and independent anchors are still required.
Past snapshots cannot be relabeled FORWARD or backfilled into Original EARLY.
No current real race is acquired, formally frozen or adopted by this patch.
Production Activation remains NO-GO.

Next: supply a future race's authenticated and pre-cutoff source snapshots plus
frozen bindings, execute actual isolated acquisition, and connect remote durable
storage and formal Core/Freeze validation. T1/T2/T3 web/provider adapters remain
unimplemented; the same file reader may read independently registered cache or
pre-built snapshots but must not falsely claim an online provider attempt.
