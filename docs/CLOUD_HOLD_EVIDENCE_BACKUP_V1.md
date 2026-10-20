# Cloud hold evidence backup v1

## Problem and behavior

The stored hold diagnostic contains categories and changed paths, but not the remote JSON needed to assess 37 integrity differences. A separate environment may be unable to GET the production endpoint even though the user's app can. The existing explicit **保留の差分を確認（送信なし）** action now retains the remote body for entries classified `integrityDifferences`. It makes no additional requests. The user exports the usual research backup immediately afterward.

No new button, backend route, D1 write, sync, seal generation, receipt, or formal EARLY eligibility is introduced. This change cannot clear a hold. Original predictions, frozen marks, 💎/⚠️, source timestamps, results, reference reports and queue state remain untouched.

## Export contract

`syncDiagnostics.holdEvidence` is null before collection or after page reload. Otherwise it contains schemaVersion 1, purpose `diagnostic_only`, formalEarlyEvidence false, start/finish/audit timestamps, scope `integrityDifferences`, targetCount, holdsAtStart, complete, eligible, captured, omitted and entries.

Each entry contains raceId/modelVersion, capturedAt (time of this diagnostic GET, **not** pre-race acquisition proof), localPartsFingerprint (non-cryptographic comparison hint, **not** an authenticated receipt), and response with ok/raceId/modelVersion/status/updatedAt/record. The record is a detached copy of the server audit body. Internal canonical local revision text is never exported.

The remote server's original JSON string formatting is not retained. JSON values are retained without hydration, recalculation, migration, schema repair or re-sealing. Existing top-level backup schema and races/oddsHistory structure stay unchanged.

`complete` means the bounded audit visited all active holds without failed/deferred entries; it does not imply that every remote body was captured. Capacity omissions are separate. The audit still visits at most 100 holds. Oversize/budget/invalid/stale omissions are explicit; eligible refers to integrity-difference responses considered for collection.

Each evidence entry and its internal local canonical revision are independently limited to 262,144 UTF-8 bytes. Aggregate serialized evidence-entry bytes are limited to 8 MiB, at most 100 entries; envelope metadata is additional. The corresponding internal revisions add at most another 8 MiB. The normal research backup itself is not capped by these extra-material limits.

## Lifetime and stale data

Remote bodies live in memory only. No remote JSON or duplicate source body is written into localStorage/IndexedDB. The small existing diagnostic summary continues to persist as before. A new audit replaces the temporary collection after the busy check. Failed/partial audits cannot silently reuse bodies from the previous audit.

At export, a body is included only if its hold is still active, its latest saved diagnostic remains an integrity difference from the same audit generation, and all local audit parts plus queue status are still exactly equal to their canonical value at capture. A local change or cleared hold removes that body from export, counted as stale. The local comparison uses the exact internal canonical string rather than relying on a 32-bit hash match.

Backup import does not load this diagnostic collection. Existing consumers of `races` and all restore/sync/KPI paths ignore it. The user sees collection guidance and the actual written count in the backup completion message. A reload discards bodies and requires another explicit audit.

## Validation

- Focused tests cover GET-only behavior, exact detached responses, original/hold/KPI preservation, category exclusions, concurrent clicks, stale revisions, cleared holds, restart/import isolation, replacement after errors, UTF-8 and aggregate caps, unsuccessful envelopes, partial timeouts, and local summary persistence failure.
- Run full `npm run check` after dependencies for the root and mcp are installed. Report browser/tooling environment failures separately; the GitHub full integration job must pass at the exact current head/base before merge.

## iPhone flow after GitHub verification and deployment

1. Reload the app once to load this change.
2. Open validation dashboard > hold details > 保留の差分を確認（送信なし）.
3. Wait for completion. Do not reload the page afterward.
4. Export research backup; inspect the completion message's 照合資料 count.
5. Attach the exported file as ZIP. Do not paste the JSON body into chat.

The count can differ from 37 if the data changed, the app cannot read a record, or a capacity limit is hit. Do not infer success merely from the expected historical count. Nothing in this flow authorizes automatic reconciliation of the outstanding source conflicts.
