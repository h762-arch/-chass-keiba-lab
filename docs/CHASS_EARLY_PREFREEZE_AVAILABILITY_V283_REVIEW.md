# EARLY prediction availability v2.8.3: repository adaptation

Source: user-supplied CHASS_v2.8.3_runtime_hotfix_patch(1).zip.
Base: 162e5a50076924442b8c0014d61d79d43fe91cd9.
The uploaded module's 28 tests passed before adaptation. Its original archive
remains unchanged. README.md is not applied over the repository root README.

## Accepted policy

This new independent overlay distinguishes candidate prediction availability
FULL / DEGRADED / HOLD from formal evidence/KPI. Missing storage/readback or
permanent cross-race horse IDs may degrade a race-local candidate. Broken race
identity, roster, source cutoff, ambiguous assignment or Final5 holds. A valid
Final5 has exactly five unique on-roster horse numbers. Explicit CPSI
NOT_APPLICABLE is non-blocking. Retry configuration describes a one-retry policy;
this pure function does not execute retries or isolate running modules.

The original early-prefreeze-gate-v1.mjs remains unchanged. No app, Worker,
workflow, store or runtime orchestration is wired to this overlay by the patch.
The ZIP name does not mean it modifies an existing live runtime. No operational
error logs were supplied, so resolving particular production errors is unverified.

## Reproduced issues and corrections

The uploaded module returned FINAL5_READY_FULL for an impossible calendar date,
an ID on a different JST date than startAt, a contradictory recognized legacy
date, and a resultPresent:true input. It also returned NOT_APPLICABLE with a
numerical CPSI value, and the public horse-key helper executed an input getter.
The adapted version validates calendar/JST identity, preserves recognized legacy
namespaces, rejects explicit known-result input, rejects contradictory CPSI
declarations, and copies public helper inputs without executing callbacks.

CPSI score/count must belong to the same AVAILABLE declaration. Conflicting
aliases or two conflicting declarations degrade with INVALID and no numerical
score. Undeclared fields cannot override a coherent declared compatibility pair.
The original fixture's valid compatibility and not-applicable behaviour remain.

Recognized IDs include YYYYMMDD_venue_race, YYYYMMDD-JRA/NAR-code-race, and
YYYY-MM-DD|venue|race. Calendar/date/race conflicts in recognized formats hold;
pipe IDs also bind the venue. Legacy organization/venue-code authenticity remains
external; this module does not certify the relationship of a numeric code to a
venue name. Opaque legacy IDs retain the existing declaration-level G01 checks.
No new race-ID namespace is imposed on existing persistence.

## Authority and evidence limits

predictionCanFreeze is retained for API compatibility and means only that the
caller declarations permit a candidate under this overlay. It is not execution
authorization or proof that an original EARLY was frozen. Every path now states
assessmentBasis:CALLER_DECLARATIONS_ONLY, freezeExecutionAuthorized:false,
earlyFreezeVerified:false, formalKpiReadiness:HOLD, formalKpiEligible:false,
MODEL_HOLD and NO-GO. Those decisions are fixed, even if the imported formal
gate's behaviour changes in a later version.

Temporal verification is relative to declared freeze/start/source times. No
trusted current clock, current-day qualification or actual result-source proof
is established. Synthetic tests do not establish acquisition authenticity,
model accuracy or successful production persistence. Historical formal promotion
stays forbidden. No diamonds/warnings/marks are created or rewritten here.

## Apply and validate

Only add src/prediction/early-prefreeze-availability-v2.mjs, its test file and this
document. Run syntax checks, the new tests plus existing early-prefreeze gate and
adapter/store binding tests, then npm run check. Integration into an actual
orchestrator needs its input mapping and error logs reviewed separately.
