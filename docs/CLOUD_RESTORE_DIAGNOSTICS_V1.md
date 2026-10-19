# Cloud restore diagnostics and held-record recheck v1

Base main: 1959eb76d95a0b7fad9e24ea5f75b9543241afb8 (PR #267).

## Problem and behavior

The user's before/after backups differed only in exportedAt; their race data did
not change. That proves no enrichment was present in those exports, not why the
restore failed. The old UI showed holds ahead of errors, discarded error detail,
and wrote a temporary completion string that the next render could replace.
The fallback localStorage write could fail without a failed restore outcome.

Restore and read-only recheck now have their own persistent operation result,
separate from the sync hold count. The panel shows connecting, validating and
saving, then received/added/enriched/result-added/unchanged/conflicting rows, or a
safe error category. A zero-row response explicitly shows zero rows. Rendering
failure after a successful save is distinguished from a failed save. Reloading
an unfinished operation reports interrupted, not complete.

The operation has a 20-second request/body deadline, single flight, and a safe
allowlist of error labels. Raw exception messages, server detail and tokens are
not included. Server DB unavailable/read/schema codes retain distinct safe
categories. No timer retries or new automatic fetch schedule are introduced.

## Persistence and original ownership

Restore validates the response container and rejects duplicate race identities
before merging. It stages merges and saves them to IndexedDB atomically, or
checks the localStorage fallback return value, before committing memory state.
A failed local save leaves raceCache and the research audit unchanged.
Newer local revisions created during an IndexedDB transaction are retained and
counted as deferred. The report cannot call them restored/enriched rows.

Existing prediction, market and FINAL snapshots remain owned by the local
original. Missing layers can be enriched only through the existing guarded
merge. Differing originals, models, nested race identities, or an inconsistent
race.raceId are quarantined. Local conflicts remain visible. No race renaming,
model reassignment, new Freeze, source repair or mass hold-clear is performed.

The four inconsistent rows seen in the user's backup are not repaired here.
Their real identity/source must be resolved separately; changing their wrapper
or model to suppress a hold would not establish provenance. Browser rows with
missing legacy identity fields remain conservative; this release does not
invent their missing identity.

## Recheck without sending

The new button issues GET /api/db/manifest only. It sends no POST and performs
no dataset restore. Duplicate or malformed manifests cannot clear holds.
Only an exactly matching fresh race/model descriptor, with a locally consistent
and non-conflicted record, clears a hold. Missing/differing models, incomplete
results or conflicting originals remain held. Matching descriptors are not
cryptographic source proof or EARLY eligibility. Normal sync is a separate
button. Read actions are blocked while an existing sync POST is in flight.

This is an application request-method boundary, not a claim that the existing
server manifest handler never initializes its D1 schema. This change adds no
Worker route, SQL, migration, production deploy or flag change.

## Backup diagnostics

Existing schema-1 research backups remain readable. New backups add optional
syncDiagnostics with the held identities/reasons/times and sanitized operation
summary. Diagnostics contain no raw requests or raw errors. Import ignores that
diagnostic metadata: importing a backup cannot replay holds or claim a completed
operation. This addresses the earlier inability to reconstruct the 44 holds
from the research-only backup.

## Runtime probe maintenance

The earlier probe pinned PR #265 browser bytes, which made any intentional app
change invalidate its tests. The CLI now resolves the selected checkout's local
Git HEAD commit and blob IDs, and verifies both working files against that
commit before contacting production. Dirty assets and missing Git references
stop before network access. Caller-supplied test references are explicitly
labelled CALLER_SUPPLIED. No Git network command is used. The origin, four GETs,
canonical HTML route, body limits, redirect rejection and NO-GO gates remain.

The expected source commit is evidence about local Git, not independently
authenticated GitHub/Cloudflare provenance. Compare that SHA with the intended
reviewed main before interpreting asset agreement. A patch validation worktree
with uncommitted changed assets intentionally fails the production probe.
The existing offline capture format's PR #265 sourceCommit remains unchanged;
it is independent of the CLI's current Git reference selection.

## Acceptance and limits

Regression tests cover hold/error coexistence, HTTP/JSON/timeout failures,
malformed and duplicate payloads, storage failures, result enrichment with
unchanged originals, zero-row results, reload, no-send recheck, model and
fingerprint mismatch, concurrent restore/save, backup compatibility, render
failure, and POST/read serialization. Separate probe tests validate dirty Git
reference rejection. No private user backup is included in the patch or tests.

Tests do not prove the user's original restoration failure cause, release
deployment, real iPhone persistence or resolution of all 44 held records.
After review/merge/deploy, perform one restore and inspect the durable operation
panel, then use recheck. Do not repeat large exports until the panel indicates
whether data was saved. Review inconsistent originals separately.

Formal KPI HOLD / Probability MODEL_HOLD / Production NO-GO remain.
