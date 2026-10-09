# Phase90: bounded acquisition executor

Base main: 81477c0217ae471b465a27e83d534403ed805264 (PR156).
Authority: v2.15.5 Acquisition-First / CONTRACT_V04.
https://docs.google.com/document/d/1VivM-SpbiyKwJENk58wWlGdeBqGO0L1iapWXw4KQHhk/edit

## Scope and actual validation

`executeBoundedPredictionAcquisitionV2155({plan,collectors,clock})` executes one
required field's preregistered T0-T3 acquisition sweep using supplied collector
functions. It creates immutable attempt records from actual function calls,
not from a manually supplied declaration of completion.

This module has no built-in Drive, network, DB, CLI, save or scheduling code.
Tests use synthetic source collectors; no real-race source acquisition, formal
adoption, production data write or KPI denominator change is claimed.
Collectors own source access and must be independently authenticated and
authorized by their caller. Provider PASS assertions are not authenticated by
this executor. Preregistration/Freeze storage proof also remains external.

## Preregistered plan

- version v2.15.5; mode FORWARD; stage ORIGINAL_EARLY;
  immutableStatus FROZEN; leakageGuard PASS.
- planId, runId, raceId, eligibilityId, scopeKey, fieldId,
  requirementSnapshotId, contractFreezeId (all required).
- acquisitionRequired MUST_ACQUIRE or MUST_ATTEMPT_PIPELINE; numericMetric boolean.
- Explicit-timezone frozenAt < cutoffAt < offAt. The acquisition cutoff is the
  data deadline, not a cancellation deadline. No post-cutoff result is accepted.
- maxAttemptMs integer 1..5000, four ordered tiers with provider/sourceCandidate:
  T0_CACHE_REGISTRY, T1_CANONICAL_PROVIDER, T2_ALT_AUTHORITATIVE,
  T3_PRE_CUTOFF_BUILD. One attempt per tier, no retries.

All four collector functions must exist as own properties of the collector map
before the first call. Missing configuration returns HOLD with zero attempts;
it cannot create EXHAUSTED_DECLARED. No field is silently changed to ineligible.
NOT_REQUIRED fields do not use this required-acquisition executor.

Collector receives a deeply frozen context with all binding IDs, planHash,
tier, provider, sourceCandidate, stage, cutoff/off times and an AbortSignal.
The plan is copied and hashed; collectors cannot mutate its frozen context.
The clock must be finite, monotonic and within the preregistered interval.

## Outcomes and audit

- FOUND: exact run/race/horse-scope/field/eligibility, sourceSnapshotId,
  sourceStage EARLY, identity/lineage/leakage PASS, capturedAt/dataAsOf, value.
  dataAsOf <= capturedAt <= observed completion < cutoff. Required numeric
  values are finite numbers. Genuine zero remains zero; null/UNKNOWN/NaN are
  rejected. Stops the sweep with RESOLVED and original source value.
- NOT_FOUND / READ_FAILED / BLOCKED / NOT_APPLICABLE require a reasonCode and
  count only after an actual registered collector call. Proceed to the next tier.
- Thrown provider errors are sanitized to COLLECTOR_READ_FAILED, recorded, and
  may proceed within the four-tier bound. Exception text is never exposed.
- CONFLICT, invalid receipt/provenance/value, cutoff reached or bad clock:
  HOLD/IN_PROGRESS; never exhaustion permission or negative ability evidence.
- Timeout: AbortSignal is issued, one timeout record is retained and progression
  stops as HOLD/IN_PROGRESS. Abort is cooperative; an uncooperative collector
  might continue independently. No later tiers are run and no exhaustion is
  declared while that uncertainty remains. The caller must avoid side effects
  and use collectors that honor cancellation.
- Only four completed non-FOUND/non-CONFLICT tiers yield EXHAUSTED_DECLARED.
  Output value is null, exhaustion code/reason and final source state are
  retained. An eligible unresolved field remains in its eligible denominator.

attemptId is planId + ordinal; caller must ensure unique immutable plan IDs.
Records preserve AttemptNo/Tier/Provider/SourceCandidate, start and completion
timestamps, planHash, binding IDs, result and reason/source ID. All outputs are
deeply frozen, persisted=false, formalKpiEligible=false, adopted=false and
productionActivationReady=false. No Freeze ID or persistence receipt is minted.

## Phase89 compatibility correction

A source newly retrieved during an attempt can have capturedAt later than its
attemptedAt. The ledger adapter now accepts an optional completedAt, requiring
attemptedAt <= completedAt <= Acquisition Freeze, and uses completion as the
latest permitted source capture time. Legacy attempts without completedAt keep
the previous attemptedAt bound. Future/invalid completion remains HOLD.

This permits legitimate bounded retrieval without backdating a newly acquired
source to the start of the attempt. It does not relax pre-off, field/core Freeze
limits, source identity, content matching or external-anchor requirements.

## Next required connection

Register authenticated source adapters for an explicit live race and frozen
field contract; execute bounded acquisition; atomically persist and read back
attempts/field states; independently verify Source/Identity/Core/Final5/Role
Freeze receipts; then connect core save admission and per-metric KPI readers.
Current Drive templates cannot substitute for those receipts. Core-valid
prediction KPI continuity is preserved by the Phase88 contract, but actual
runtime adoption remains pending. Original Signal/Freeze, production flags,
app/Worker and deployment configuration are unchanged. Activation stays NO-GO.
