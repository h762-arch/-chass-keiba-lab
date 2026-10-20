# Automatic result commit guards v1

## Reproduced problems

The browser queue captured a record before awaiting the official result request. Success and failure paths then saved that old record without checking whether the user had saved a manual result, paused the queue, changed the record, or deleted it while the request was pending. A late response could overwrite or recreate newer state.

Automatic completion also filtered/coerced finishers without requiring distinct positive known horse numbers, and marked completion without checking the returned record. The base application and scratch wrapper each saved once, producing two logical saves for one completion.

## Change

- Check stored record/queue selection binding before fetching: race ID, available date/track/race/organization/model metadata, and original layer binding must agree. Missing/changed/deleted candidates are deferred rather than fetched from an inconsistent selection.
- Capture the exact canonical current record revision before each request. Recheck that revision and the global auto-result switch after both success and failure. Any change is preserved without success/retry writes. Return a deferred count.
- Declared response identity must match the saved selection. Reject false success, non-array or insufficient finish order, duplicates, zero/negative/fractional/blank/object/boolean/unknown horse numbers, inconsistent result rows, unrelated actual-time keys and malformed supplied acquisition timestamps.
- When full result rows are present, their ranked first three horse numbers must agree with the declared first three. Same-position ties retain the source row order; do not generate a new tie policy.
- Preserve completed/manual results. A stale direct application cannot replace a newer cached record.
- Mark completed only when guarded application actually returns a saved record. Malformed result data uses the existing bounded retry schedule with `AUTO_RESULT_INVALID`; unpublished results retain the existing pending schedule.
- Build the result and reference report, reconcile scratch/result participation, then save once. There is no intermediate persistence of a partially reconciled result.

No recomputation of original predictions, market/FINAL snapshots, frozen ◎○▲△☆/💎/⚠️ or existing seals is added. No formal EARLY receipts or KPI promotion are introduced. Previous held records are neither migrated nor reconciled. Worker/Cron result processing, D1 schema, external endpoints, production flags and test workflows are unchanged.

## Validation

- Initial 29 new regression cases against the original main: 27 failed, 2 passed, demonstrating overwrite/validation/double-save issues.
- Final tests cover malformed inputs, response/queue binding, valid NAR/JRA completion, single-save behavior, late success/failure/delete, manual-result preservation, remaining-queue progress, concurrent queue calls and compatibility with existing official-parser HTML fixtures.
- The NAR/JRA parser checks use repository fixtures offline. They do not demonstrate current live source availability or production deployment.
- Full `npm run check` is required before merging the exact current head/base. Local browser availability must be reported separately. Workers Builds success alone is insufficient.

## Completion boundary

This package fixes future browser automatic-result commits. It does not claim every pending result will become available, resolve the historical sync holds, or authorize formal KPI/Production release. It requires no additional historical backup export from the user. Existing auto-result behavior can continue after the normal deployment/verification process.
