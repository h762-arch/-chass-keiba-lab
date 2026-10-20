# Restore reference validation for exact original matches v1

Base main: `05ef0d69480f7175b191980fde9ac935c3bf5554` (PR #277).

## Scope

Add a user-triggered “参考検証だけ復元（送信なし）” action inside sync-hold details. It selects at most 100 currently held REMOTE_RESULT_PRESERVED identities previously diagnosed as referenceOnly. The saved diagnosis is a candidate list, never authorization: every body and current scalar descriptor is fetched again. An absent diagnosis requests an audit first.

The action writes only four local reference fields: `validationSnapshot`, `resultQueue`, `validated`, `validationCompleted`. The two legacy booleans describe reference-report completion here. They do not create authenticated EARLY acquisition receipts or eligibility. No original prediction, market, FINAL, frozen Signal, result, integrity seal, horses, race, source timestamp, updatedAt, model weight, probability or formal KPI decision is changed.

## Required evidence

- Exact race/model envelopes, readable binding and no local cloudConflict.
- Both sides' existing integrity verification is verified with ordered prediction/result source dates; seals themselves and all protected source parts must be identical.
- A new comparison must be referenceOnly or already matched, with differences restricted to the four reference fields and their derived status.
- A complete identical result: unique known horse numbers, at least three finishers. The cloud automatic validation report must bind the same race/model, contain the exact finish order, carry automaticResultQueue, checks/failures arrays and AUTO_RESULT_QUEUE, and have a parseable generatedAt. Its completion status must be validated.
- A different existing local validation report, paused/disabled local queue, different nonempty local history, or different queue identity/non-operational metadata blocks restoration.
- The current full descriptor, including all seven fingerprint components and status, must match the planned restored record. Read the manifest after the selected bodies. No hold release on unavailable fingerprints, stale metadata, duplicates, mismatch or a changed local revision.

Cron validation `generatedAt` can be the scheduled run start, preceding the result fetch completion by seconds. It is retained unchanged as report metadata, not used as a new source-acquisition receipt or proof of a pre-race capture. Original prediction/result chronology remains governed by the existing verifier.

## Persistence and failures

Operations share the existing read single-flight and block cloud sync overlap. IndexedDB uses a readwrite transaction to compare the stored record and current in-memory revision before put. A newer stored record is deferred. Memory is rechecked after storage completion; a concurrent memory edit remains intact and its hold is not released. LocalStorage fallback checks the write result before publishing the restored record.

Pending/hold metadata is persisted before deleting the in-memory hold. Failure after a record commit reports partial completion and keeps the hold. Repeating after a lost hold-clear write can finish against an exact already-restored record without replacing its content. No automatic restore on startup/reload and no production POST, dataset-wide restore, schema migration or Worker write. Future remote updates remain subject to normal manifest reconciliation; a read-only local restore is not a remote transaction lock.

## Evidence and validation

The backup exported at `2026-10-20T03:08:38.295Z` contains 58 holds. The exact original matches with only reference-state differences are Morioka 2026-10-11 1R and Urawa 2026-10-19 1R. Two exact-model GETs and one fresh manifest GET were used for the offline replay.

Replay result: 2 local reference restorations, 2 holds cleared, 56 remain. Only the four permitted fields change in those two records; all other 56 held records remain byte-identical. Existing integrity remains verified. The dashboard formal boundary output is unchanged. A repeat makes no further requests or data changes. This is a local simulation using captured production reads, not a production restore or an iPhone result.

New focused tests: 21 passed, covering protected source mismatches, identity/seal/chronology, malformed report/order, manual content, stale diagnosis/manifest, idempotence, single flight, deadline, quota, synchronous/asynchronous IndexedDB errors, disk/memory revision changes, persistence failure and retry, reload and formal HOLD boundary.

Required local full check: 3,745 tests, 3,743 passed, 2 failed because Chrome is absent, zero skipped. These browser tests require GitHub verification. No full-success claim. No workflow, dependency or backend changes.

## Rollout

Use CHASS Patch PR Bridge v1. Approve workflow execution if requested and set the draft Ready for review. Wait for CHASS Full Integration Gate v1 at the current PR head and main base **before merging**; Workers Builds alone is insufficient. Keep full predeploy checks. Reverify after any head/base change. The patch has no PR head SHA until Bridge creates it.

After verified deployment, use the new reference-only action once. Verify the actual restoration/remaining counts; source changes can reduce the eligible set, so 58 -> 56 is not a production guarantee. Do not use general sync or wholesale restore to force the other holds to disappear.

Formal KPI: HOLD / Probability: MODEL_HOLD / Production: NO-GO.
