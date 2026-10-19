# Stored JSON fingerprint consistency v1

Base: `7ac41df2644a3f230c67840c435480c43d21d161` (main / PR #274).

## Problem and behavior

NAR Cron validation includes `jraCalibration: undefined`. The existing stable hash includes that property, but JSON serialization drops it. Consequently, `validation_fp` could describe an object different from the stored `validation_json`. In a read-only audit of the 2026-10-19T22:04:32.911Z backup and cloud responses, all 40 REMOTE_RESULT_PRESERVED entries exhibited exactly this discrepancy. Repairing metadata alone does not reconcile different validation references, queue state, missing integrity seals, or original prediction conflicts.

Worker row descriptors now hash parsed serialized columns after row construction. Save metadata uses the effective stored columns, including validation retained when an incoming optional snapshot is absent. A conditional metadata update checks all six source JSON columns, status and updated_at. An intervening source change prevents stale metadata from being written. No hash algorithm or frozen snapshot seal changes.

The existing explicit `POST /api/db/recover-fingerprints` accepts optional boolean `refreshExisting`. Without it, previous missing-only recovery behavior remains. With `true`, complete metadata is checked against parsed stored JSON and stale values can be replaced. Both modes validate record binding and size and guard the write using all source JSON, status, updated_at and old fingerprint values. Outcomes include `refreshed`, `already_present`, `skipped` and `concurrent_change`.

The existing “照合情報を回復（クラウド更新）” button additionally targets REMOTE_RESULT_PRESERVED holds using explicit refresh. Prediction, frozen-signal and binding conflicts are excluded. It sends identity and the boolean only, never source snapshots. It clears a hold only when all seven descriptors and status match the current unchanged local record. Source content, local integrity proofs and frozen marks/signals are never copied from cloud by this operation. Differing references remain held.

## Validation and limits

- Related tests: 28 passed (9 new), including real SQLite serialization, retained optional validation, repeat idempotence, source/metadata concurrency guards, malformed/binding rejection, HTTP shape, browser source preservation and no sync POST.
- Required local `npm run check`: 3,704 tests, 3,702 passed, 2 failed, 0 skipped. Failures: Chrome absent in `tests/jra-browser-smoke.test.mjs` and `tests/viewer-nar-ability-browser.test.mjs`. Syntax checks passed. This is not full-suite success.
- Offline simulation of 40 cloud audit records: 40 metadata refreshes; all 40 source rows (including timestamps) unchanged; repeat operations wrote nothing. These are local reconstructions, not an inspection of raw production SQL bytes or a production recovery run.
- Production writes during this work: zero. No migrations, workflow/dependency changes, automatic deploy, or automatic recovery.
- Before merge: mark the Bridge-created draft PR Ready for review, then require CHASS Full Integration Gate v1 at the current head and main base. A changed head/base requires verification again. Full predeploy checks remain mandatory.

## Rollout

Use CHASS Patch PR Bridge v1 with the supplied exact base, paths, raw-patch SHA256 and gzip Base64. After full CI, merge and the normal tested production release, invoke the existing recovery button once. Record actual updated/held counts and export a new backup. Do not assume 58 holds will clear. The 13 original conflicts, frozen local Signal difference, and identity issues need separate evidence-based resolution.

Formal KPI: HOLD / Probability: MODEL_HOLD / Production: NO-GO.
