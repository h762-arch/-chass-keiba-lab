# Daily analysis V1 — research, disabled until explicit rollout

Baseline main: cd5c4ad7e5b5736f8c757d1a6d60432059ec9966.

## Implemented in this increment

- Existing five-minute Worker cron dispatches a daily research job only at
  00:00 UTC / 09:00 Asia/Tokyo, with at most five minutes of dispatch delay.
  Real calculation/save/readback times are checked; no timestamps are backdated.
- Same configured Google service account, read-only scope, pinned file registry,
  before/after file version and modification-time checks. No credential migration.
- Complete registered PRE roots are retained; canonical CPSI-only artifacts
  remain market-blind. No market/evidence is inferred from raw indices.
- Recompute CPSI; run existing Wave analysis; review the frozen market favorite
  with existing Favorite v2.1; list every active horse ranked sixth or lower.
  Missing popularity leaves the scope unconfirmed and all active horses visible.
- Qualitative longshot research candidates follow user v1.0: place scenario plus
  ability and EV support for one diamond; win scenario for two; ninth-or-lower
  plus at least two distinct explicitly strong support references for three.
  Numeric CPSI alone is not ability backing: require an explanation bound to
  the exact horse key and index snapshot. These are
  unauthenticated caller-evidence candidates, never formal signal assignments.
  Mere popularity/low EV cannot produce a warning or diamond.
- Favorite reviews bind roster, computed CPSI, Run and market/input snapshots.
  Existing Favorite v2.1 returns warning/recheck review, not a calibrated trust
  probability. `trustProbability` deliberately stays null.
- Separate additive research tables, once-only date claim, per-race isolation,
  input/result SHA, independent result recomputation and physical D1 readback.
  Duplicate identical inputs deduplicate; conflicting Runs for one race HOLD.
- Authenticated GET `/api/chass/v1/research/daily?date=YYYY-MM-DD`; private no-store.
  Records whose readback failed are not served as successful results. Reads of
  historical saved artifacts are replay, not newly generated historical PRE.
- App card for date, four lanes, all CPSI rows and all longshot-scope rows.
  It uses the already configured session-only Drive reader key; no new browser
  credential, key persistence, public API, formal marks or EARLY writes.

## What this increment does NOT complete

This is NOT the complete image-to-app daily operation requested by the user.
Do not enable it and describe the full automation as complete.

1. A separately disabled strict NAR phone-image adapter is described in
   DAILY_IMAGE_INTAKE_V1.md. Its live OCR accuracy and Google setup are not
   verified. Saving arbitrary PNGs alone does not make an accepted input.
2. Discovery of all scheduled races, automatic day roster and official market
   acquisition are not added. Scope is registered feeds, maximum 8 sources with
   24 inputs per source; do not claim complete nationwide JRA/NAR coverage.
3. Favorite/longshot route narratives and support evidence are not generated
   from screenshots. Missing evidence is HOLD, not automatically synthesized.
4. No calibrated favorite win/top3 trust probability, provider authentication,
   full Role scorer, Formal KPI promotion or prediction-prompt rewrite.
5. Output is isolated D1 research storage. A separately disabled Drive archive
   adapter is described in DAILY_DRIVE_ARCHIVE_V1.md. Live OAuth, output sync
   and reference-catalog publication have not been configured or verified.
6. A claimed job that crashes stays RUNNING for operator inspection. There is
   no silent retry/replacement of the 09:00 record or automatic late promotion.
7. Missing prior history is NOT_READ, never zero records or a fabricated 50.

`COMPLETE` means every supplied registered input completed its research review;
it does not mean all races were discovered, OCR completed, or trust probabilities
were produced. Summary always declares `allScheduledRacesConfirmed:false`,
`imageOcrConnected:false`, `driveOutputSync:false`. The app makes this visible.

## Input contract

Existing `CHASS_CPSI_PRE_INPUT_V1` full roots in the registered feed may carry
`race.originalEarlyMarket`, `race.waveEvidence`, `dailyPriors` and `dailyEvidence`.
Keep original evidence immutable. The body used by the new result is retained
as `inputJson` with its independent hash. Unknown or incorrect dates, result
data, late source times, mixed identities and post-start work fail closed.
Input fixed after the actual job start cannot become its 09:00 evidence.

`dailyEvidence.context` binds `raceId`, `runId`, `inputSnapshotId`,
`marketSnapshotId`, `capturedAt` and `sourceRef`. `favorite` uses the exact existing
Favorite v2.1 case schema, including roster/evidence context and computed CPSI.
`longshots` is a maximum-32 list of `{horseNo,horseKey,winScenario?,placeScenario?,
supportRefs,strongSupportRefs?,abilitySupport,evSupported?,evSourceRef?}`.
`abilitySupport` binds `{horseKey,indexSnapshotId,explanation}`; strong references
must be a distinct subset of supportRefs. Identity, reference and time checks are
metadata consistency, not independent authentication of source assertions.
`REAL_PRE_ODDS` and `PREDICTED_ODDS` are explicitly distinguished.

## Rollout checklist (not performed by this patch)

1. GitHub Full Integration Gate at matching PR head/base, then review/merge.
2. Apply only `migrations/0016_daily_analysis_v1.sql` to the intended D1 database
   through the existing deployment process. No old tables/data are altered.
3. Verify registered real inputs and complete the missing acquisition/evidence
   stages above; test one future race end-to-end before claiming live readiness.
4. Explicitly set `ENABLE_DAILY_ANALYSIS_V1=true` only when the desired limited
   scope is understood. Existing `ENABLE_CPSI_DRIVE_READ=true`, registry, reader
   token and service account remain required. Default absence is disabled.
5. Verify Workers build, scheduled execution, physical result readback, app
   access and failure paths. Pages success does not verify Worker deployment.

No production migration, cron activation, GitHub merge or live write is performed
by creating this patch. Local synthetic tests are not a live Google/D1 test.
