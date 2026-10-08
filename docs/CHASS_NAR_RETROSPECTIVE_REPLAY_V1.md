# Phase80: NAR retrospective evidence replay v1

## Purpose and authority

An offline, research-only way to replay a historical NAR master capture after
reviewing race identity, horse names, and actual participation. Late official
records cannot satisfy a pre-off availability requirement. This replay has a
different snapshot schema and separate consumer entrypoint; the existing
`createPredictionEvidenceSnapshot` pre-off timing gate is unchanged.

`createNarRetrospectiveEvidenceSnapshot` and `compareNarRetrospectiveEvidence`
are NAR-only research interfaces. `compareNarPredictionEvidence` rejects their
snapshot schema. Replay snapshots carry `earlyEligible: false`,
`formalKpiEligible: false`, `productionActivationReady: false`, and unverified
historical feature availability. A historical cutoff is a reference time,
not proof of when features or metadata were available. Hashes prove internal
consistency, not independent authentication or a timestamped original version.

No production import, DB write, Drive write, deploy, flag, model weight,
Original Signal, or Prediction Freeze is changed. Production Activation remains
NO-GO and formal EARLY adoption remains HOLD.

## Interface

`replayNarMasterEvidence({masters, review, source, runId, modelVersion,
cutoffAt, offAt})` composes the existing master adapter, explicit retrospective
snapshot builder, and existing app-based NAR calculation.

`masters` uses the Phase79 bounded archive export shape. `review` requires:

- Exact source and canonical race IDs, matching date/course/race number/surface/distance.
- Basis `POST_RACE_IDENTITY_ONLY`, actual observation time, and HTTPS references.
- The complete participant set, with unique positive horse numbers, official
  names matching the corresponding historical rows, and explicit ACTIVE status.
- Explicit `approvedIndexAlias` for every discrepant index name.

The reviewed participants establish historical participation only; they are NOT
pre-off ACTIVE proof. Namespaced archive IDs remain archive IDs. In particular,
an OddsPark identifier is not silently relabelled as an official NAR identifier.
The caller remains responsible for reviewing sources; this module does not
fetch or authenticate any page. Duplicate or absent identities/statuses HOLD.

The source availability time must be on/after the race off time, no later than
the metadata observation time, which must be no later than the re-export time.
Source times are caller declarations. The consumer rechecks these constraints,
eligibility flags, provenance, and snapshot hash.

## Comparison meaning

The baseline is explicitly feature-reduced: original PeakIndex, CourseIndex,
and assigned weight, without historical runs. It is NOT a saved original
prediction or a uniform invented forecast. The candidate includes the permitted
raw indices and prior runs, using the unchanged existing NAR app calculation.
Insufficient ability fields keep probabilities null rather than fabricating them.

Raw-index mapping is explicitly approved only for isolated research, not certified
calibration. Ablation traces distinguish probability/ability-mark changes from
TIME research. Prior history currently influences TIME research only; it does
not prove the NAR probability model consumes all historical features. Pressure,
position, pedigree, and signal research remain unsupported by this consumer.

Current-race result/odds/popularity/time and final going are not projected into
features. Final going is not backfilled: TrackCondition_EARLY remains UNKNOWN.
No new Final5, star mark, diamond, warning, performance, or profit claim is made.

## Executed archival replay (2026-10-08)

Input: Phase79's bounded Drive capture, `20260914_OOI_12`, not a fresh Drive read.
Official records confirmed the historical race and participants:

- NAR official race result: <https://www.keiba.go.jp/KeibaWeb_IPAT/TodayRaceInfo/RaceMarkTable_ipat?k_babaCode=20&k_raceDate=2026/09/14&k_raceNo=12>
- Official scheduled off time (20:50 JST): <https://sp.keiba.go.jp/KeibaWeb/TodayRaceInfo/OddsUmLenTan?k_babaCode=20&k_raceDate=2026/09/14&k_raceNo=12>
- プロローク archive ID: <https://www.keiba.go.jp/KeibaWeb_IPAT/DataRoom/HorseMarkInfo_ipat?k_lineageLoginCode=30013400407>
- ハイケンス archive OddsPark ID: <https://www.oddspark.com/keiba/HorseDetail.do?lineageNb=2021102813>

Two explicitly approved aliases: 4 プロローグ → プロローク;
8 ハイグンス → ハイケンス. Original Drive labels are retained in the model
output; the separate review holds official display names. No source rewrite.

All 13 runners and 129 prior runs joined. All 13 raw INDEX ablations changed
probability/ability output, and all 13 HISTORY ablations changed TIME research
only. Before/after probabilities changed for 13 horses; ability-mark assignments
changed for 3 horses (2 loses ○, 3 ▲→○, 10 gains ▲). This demonstrates propagation,
NOT improved prediction accuracy. The final result was inspected for metadata;
therefore this is a hindsight-exposed retrospective replay, never formal EARLY.

Snapshot hash: `1a841d67cbf1348f6a1447497026e64ea0718d895dd164746b96ad620eaa777d`.
Raw source hash: `321ff6bc3615f61f01e0136e0e0e2d86651ae763d02e60773fa886c9a3e25975`.
Run/model IDs, observation time, raw capture, source references, adapter audit,
snapshot, and before/after ablation traces are in the separate audit artifact.
No raw race data or result table is committed to this repository.

## Verification

```sh
node --test tests/nar-retrospective-replay-v1.test.mjs \
  tests/prediction-evidence-bridge-v1.test.mjs \
  tests/nar-prediction-evidence-consumer-v1.test.mjs \
  tests/nar-master-evidence-adapter-v1.test.mjs
```

11 new tests and 32 existing related tests pass. Full repository CI and PR diff
audit are required before merging. Replay success does not remove the remaining
need for a future race's independently versioned pre-off feature snapshot and
valid market-inclusive Freeze audit.
