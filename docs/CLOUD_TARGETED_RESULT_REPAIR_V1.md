# Targeted local result repair v1

## Scope

The latest home-screen app backup has 1,630 races, 9 odds histories and 44
durable sync holds: 40 REMOTE_RESULT_PRESERVED and 4 snapshot_binding_conflict.
All 40 result-preserved records lack a local resultSnapshot. The race and odds
payloads are unchanged from the earlier home-screen backup. Safari is a separate
dataset and must not be silently combined with it.

This patch adds a user-triggered `不足結果を補完（送信なし）` button. It targets
only result-preserved holds with no existing local result, consistent bindings
and the same held model version. Binding-conflict holds are excluded.

## Read and save boundaries

- GET `/api/db/result-repair?raceId=...&modelVersion=...` performs one bound
  SELECT, exact race/model, LIMIT 1, without schema initialization or D1 writes.
- The response contains the race identity, original prediction and stored result
  for that model. It does not read the full research dataset, predictions table,
  results table, market/FINAL JSON or another model. No hash backfill is performed.
- The browser reads sequentially, at most 100 candidates per click, with the
  existing 20-second request/body deadline per target. No automatic loop starts.
- Identity, organization, model, every original prediction field and a complete,
  unique finish order using known horses must match before local save. Prediction
  equality uses canonical full content, not just a 32-bit fingerprint.
- Only resultSnapshot and a missing resultAcquiredAt are added. Existing results
  are never replaced. Original prediction, market, Signal, FINAL, warning/diamond
  evaluation, race data, result queue, formal validation flags and holds stay intact.
- Each accepted record is saved to IndexedDB or checked localStorage before the
  in-memory result and success count are committed. A newer local revision is
  deferred instead of overwritten in memory. Concurrent user saves use existing
  persistence transactions; no new synchronization writer is introduced.
- Read/write flight guards prevent this action from running alongside a sync
  POST; new automatic sends during the read remain pending.
- On transport/save failure, stop and preserve previously saved repairs. Reruns
  skip records already containing results. Mismatches stay unchanged and count
  as conflicts. Original holds are neither relabelled nor cleared.
- Progress and final/partial counts persist through the existing backup diagnostic
  state. A successful repair is not a cloud sync acknowledgment or formal EARLY
  validation. The old four incorrect bindings require separate source review.

## Verification limits

Unit tests cover identity and original prediction mismatch, duplicate/unknown
finishers, existing manual results, local save failures, concurrent edits, single
flight, deadline, resumability, persistence of diagnostics and SELECT-only server
access. A real-backup-copy test uses clearly synthetic responses only; its results
are never exported as race data or sent to the user app.

Production endpoint behavior and actual device repair are unverified until the
patch is merged and deployed. None of the 40 local results has been repaired by
merely creating this patch. No guarantee that every target passes identity checks
is made. The full restore endpoint and legacy fingerprint metadata repair remain
separate work. LocalStorage quota constraints may still block local save.

Deploy Worker and browser together. After verifying CI and production source
reflection, use the new button once in the home-screen app, not Safari. Preserve
the latest backup before the action and inspect counts before any other sync.

Formal KPI: HOLD / Probability: MODEL_HOLD / Production: NO-GO.

## Evidence

- User-provided `CHASS-research-backup-20261019-v10.0.1(2).zip`, exported
  2026-10-19T09:56:21.046Z, and earlier home-screen backup.
- https://github.com/h762-arch/-chass-keiba-lab/pull/270
