# Phase88: Acquisition-first Prediction KPI policy contract

## Authority checked on 2026-10-09

- Drive prompt: CHASS正式予想指示プロンプト_v2.15.5_AcquisitionFirstFormalKPI_2026-10-09
  https://docs.google.com/document/d/1VivM-SpbiyKwJENk58wWlGdeBqGO0L1iapWXw4KQHhk/edit
- Canonical workbook: CHASS競馬研究所_アーカイブマスター
  https://docs.google.com/spreadsheets/d/1dqFySEgG6cYEXIx8BmOw7tPOe7wI90H_No1FRoXlgoI/edit
- Bounded reads: CHASS_BASELINE_AVAILABILITY_V1 A1:L35,
  CHASS_BASELINE_READINESS_V1 A1:R35,
  CHASS_V215_FIELD_ELIGIBILITY_LEDGER_V1 A1:AF35,
  CHASS_V215_ACQUISITION_LEDGER_V1 A1:T35,
  CHASS_V215_READINESS_GATE_V1 A1:AH10.
- CONTRACT_V04 (15:00 JST) separates missing numeric fields from core-valid
  prediction KPI eligibility. Required acquisition must become terminal.
- Field and acquisition ledgers in the inspected ranges contain policy templates,
  not authenticated per-race acquisition/Freeze receipts. Do not promote them.

## Main audit before this patch

Base: cdc0e5a3c1424021afb0b5df3ddd20a150991347 (PR154).

There was no implementation of FORMAL_FULL,
FORMAL_WITH_DECLARED_MISSING, EXHAUSTED_DECLARED or the new acquisition ledger.
`nar-initial-research-bundle.mjs` requires frozen, positive odds/popularity for
all runners in its market-dependent initial research bundle. This does not
implement the new distinction between Core Prediction and field-specific EV.
`nar-early-freeze.mjs` and retrospective research modules deliberately keep
formalKpiEligible=false; retrospective replays must keep this protection.
`jra-early-result-kpi.mjs` currently assigns formalKpiEligible from PRE_POST
timing and computes Brier values. It has no v2.15.5 model-promotion/acquisition
contract join. Timing alone is not the new full governance contract.

## New isolated evaluator

`assessPredictionKpiContractV2155({contract,core,fields,attempts})` is a pure,
network-free, persistence-free policy evaluator for ORIGINAL_EARLY / FORWARD.
It returns a deeply immutable, input-hash-bound **policy candidate** assessment.
No public route, app UI, Worker import, runtime flag, D1 schema or save adapter
is changed. No source collection is performed by this function.

The caller must authenticate all supplied receipts against the frozen Source
Registry, Field Eligibility, Acquisition, Readiness and Prediction Ledgers.
Strings such as snapshotHash, sourceSnapshotId and gate PASS are NOT themselves
cryptographic or provenance proofs. The inputHash protects audit reproducibility,
not external authenticity. This evaluator must not be used as an adoption receipt.
All outputs retain formalKpiEligible=false, adopted=false and
productionActivationReady=false even when formalPredictionKpiCandidate=true.

### Normalized input contract

- contract: version v2.15.5, baselineReadinessVersion CONTRACT_V04, freezeId,
  sourceSnapshotId, frozenAt (explicit timezone), fields (1..2000).
- Each contract field: unique eligibilityId and scopeKey/fieldId pair,
  requirementSnapshotId, frozen eligibilityStatus, acquisitionRequired
  (MUST_ACQUIRE / MUST_ATTEMPT_PIPELINE / NOT_REQUIRED), numericMetric,
  structuralMissing (explicit boolean), and reason/code for ineligible fields.
  scopeKey is the race ID or a verified runner key. Thresholds remain in the
  frozen requirement snapshot; no D/E/F/G sample thresholds are duplicated here.
- core: matching run/race/contract/freeze identities, source snapshot hash,
  fieldEligibilityFreezeId, acquisitionFreezeId, frozenAt strictly before offAt,
  immutableStatus FROZEN, resultPresent/cancelled/postFreezeMutation=false.
  Requires independent verified PASS receipts for officialCard, identity,
  sourceFrozen, sourceLineage, leakageGuard, candidateTrace, portfolio,
  preservation, roleTournament, signalEvidence, productionWritePolicy,
  baselineReadiness and fieldEligibilityProof. Five unique Final5 keys and all
  ten distinct completed role pairs are checked, not merely a reported count.
- Field receipts bind exact run/race/scope/field/requirement/freeze IDs and frozen
  eligibility; field frozenAt is between contract freeze and prediction freeze.
  Source lineage and leakage PASS, conflict=false. Resolved numeric values must
  be finite numbers (true zero is retained); sourceStage EARLY is mandatory.
- Attempts (<=8000) bind the same keys, have unique attempt IDs, sequential
  attemptNo, timestamps and frozen provenance. Tiers are fixed in order:
  T0_CACHE_REGISTRY, T1_CANONICAL_PROVIDER, T2_ALT_AUTHORITATIVE,
  T3_PRE_CUTOFF_BUILD. They occur after the preregistered contract and before
  field Freeze. FOUND ends the sweep early and binds sourceSnapshotId.
  NOT_FOUND / READ_FAILED / BLOCKED / NOT_APPLICABLE need reasonCode.
  CONFLICT cannot be exhausted into permission; reconciliation must precede PASS.

EXHAUSTED_DECLARED requires all four tiers, no FOUND, null value, final source
state, exhaustion code/reason, and SOURCE_MISSING or READ_FAILED resolution.
This adapter deliberately models one bounded attempt per tier; a provider with
another bounded retry policy needs a separately versioned normalized contract.
NOT_REQUIRED requires an ineligible contract, frozen reason, null value,
NOT_APPLICABLE resolution and no acquisition attempts. Buildable pipeline fields
must be declared MUST_ATTEMPT_PIPELINE in the authenticated contract, not
reclassified after a failed read.

## Classifications and denominators

| Policy classification | Prediction KPI candidate | Individual numeric metrics |
|---|---|---|
| FORMAL_FULL | yes, subject to independent adoption verification | eligible/resolved fields only |
| FORMAL_WITH_DECLARED_MISSING | yes, subject to independent adoption verification | eligible/resolved fields only |
| NOT_FORMAL / HOLD | no | no released metric fields |

ELIGIBLE-but-exhausted stays in the eligible denominator. Failed acquisition
cannot alter frozen eligibility or shrink that denominator. Numeric-field counts
are separate from all-field counts (e.g. a reference object need not be numeric).
Model-unready probability and proxy-market EV may be legitimately ineligible;
that does not by itself invalidate core prediction KPI. The evaluator does not
promote probabilities or compute EV, Brier, calibration or race-result KPIs.
LIVE-only fields are not missing Original EARLY fields. Other structurally absent
EARLY fields are explicitly declared by the frozen contract's structuralMissing.
Missingness is never Negative, a zero/50 score or an imputed probability.

## Remaining integration gates

1. Authenticated per-race projection of frozen Drive contracts into versioned
   Snapshot/DB inputs. No direct Production Drive runtime.
2. Real bounded T0-T3 execution, immutable attempts, reconciliation and readback.
3. Core Prediction / Final5 / Role / source provenance receipts and complete
   pre-off Freeze. Existing retrospective runs remain excluded.
4. Separate NAR core save namespace/admission from market-dependent signal/EV
   research; preserve old snapshots and market validation where genuinely required.
5. Replace JRA timing-only KPI interpretation only after promoted-model and
   field-specific metric contract joins are independently verified.
6. Adopt FULL and WITH_DECLARED_MISSING into prediction KPI denominator while
   field-specific metrics keep their own eligibility denominator.

This patch completes only the isolated policy contract, not steps 1-6 or formal
runtime activation. Missing odds alone must not be used as a blanket reason to
reject future core-valid predictions under v2.15.5; missing/invalid actual Core
Prediction Freeze, provenance or acquisition receipts remain valid blockers.
Original Signal/Freeze is unchanged; Production Activation remains NO-GO.
