# CHASS JRA exclusion / post audit SHADOW v1.1 — reviewed

## Scope and evidence status

This patch adds seven research-only files. It does not connect to app.js, Worker,
UI, D1, localStorage, network, live predictions or production. No EARLY, Final5,
marks, probability, EV, tickets, CPSI formula, Wave formula, diamond or danger
threshold is changed. Formal KPI HOLD / Probability MODEL_HOLD / Production NO-GO.

Base main: 48cebdd5be9610372106601328860011aad7a2bc.
The source tree was reconstructed locally and matched its complete Git tree
d4e610320dea3033408220b68588a9908ff4441f before changes.

The supplied archive contains two modules, two test files and a research note,
NOT the full twelve-race official results, authenticated EARLY snapshots or a
ticket ledger. Reported 2/12 anchor wins, 10/12 anchor top-three and 11/12 Final5
winner capture are user-supplied reference claims, not independently recomputed
performance. Case fixtures mix named horses with synthetic field values. They
are software tests, not records of an authenticated live acquisition.

If those three supplied counts have the same 12-race denominator, their
arithmetic rates are 16.7%, 83.3% and 91.7% after one-decimal rounding; this is
arithmetic only, not verification of the underlying counts or formal KPI.

## Independent reproduction of original contract weaknesses

The original ten tests passed. Additional synthetic inputs reproduced:
- raceDate and scheduled post's JST date could differ and still SHADOW_REVIEW;
- numeric CPSI accepted a null neutralized component weight;
- POST could declare an earlier, different scheduled post and be joined;
- sums of individually safe integer ticket stakes could exceed safe integer range.

These are input-contract failures, not proof that actual race data leaked.
They are fixed and covered by additional regression tests.

## PRE contract (schema migration required)

reviewJraFinal5Exclusions(input, options?) now requires:
- JRA venue and race 1..12, full roster 5..18 unique horse numbers 1..18;
- context: cutoffAt, runId, inputFreezeId and mode;
- mode: PROSPECTIVE or RETROSPECTIVE_REFERENCE;
- snapshot: existing snapshot/Freeze claims plus raceId, organization, runId,
  inputFreezeId, strict capturedAt and sourceRef;
- each horse: source receipt with the same identifiers, its own horseNo,
  kind=EARLY, capturedAt and sourceRef;
- market receipt when any EARLY popularity value is supplied;
- Wave receipt whenever Wave is supplied, with explicit numeric/HOLD consistency.

Receipts share the exact binding:
{raceId, organization:'JRA', runId, inputFreezeId, snapshotId,
 capturedAt, kind:'EARLY', sourceRef}; horse receipts add horseNo.
The snapshot has additional freezeId/isPreResult/freezeVerified claims.
The snapshot capture must precede cutoff and scheduled post. Evidence times
cannot exceed the snapshot capture, cutoff or evaluation clock.
The scheduled post's JST date must match race identity. Invalid calendar dates,
getters/accessors, symbols, array holes, cycles, unknown fields and non-finite
numbers fail closed as HOLD without evaluating input getters.

PROSPECTIVE also requires the live process clock to be on race day and not
after cutoff. Injected now is for deterministic tests only; its clock authority
is explicitly CALLER_INJECTED_TEST_CLOCK and prospectiveEligible stays false.
RETROSPECTIVE_REFERENCE can inspect historical PRE-shaped inputs but must never
be counted as a prospectively issued queue. A source label and freezeVerified
boolean remain caller declarations, NOT authenticated acquisition/Freeze proof.
Unchanged old payloads lacking the new context/receipts now HOLD.

## Useful review changes, without seat changes

- Preserve all five original marks exactly. No sixth/seventh mark, replacement,
  buy recommendation, bet sizing, calibrated probability or EV is produced.
- Keep high CPSI exclusions, peak/recent ability and recent-versus-condition rank
  disagreements separately visible. CPSI numeric mode requires a known neutral
  weight and 2..7 usable core components; no missing value is converted to zero.
- unknownReviewQueue preserves excluded UNKNOWN candidates even when they have
  insufficient evidence to enter the urgent ranked reviewQueue.
- Peak and recent scores are correlated. Review priority uses their maximum
  contribution, not the sum. PRE_INDEX/RECENT_RUNS share one ability family;
  DISTANCE_RUNS/COURSE_RUNS share one condition family; PACE/TACTICAL share one
  race-shape family. This is a labeling convention, not proven statistical
  independence or evidence authenticity.
- Market top-four exclusions trigger an independent market sanity review only.
  Popularity cannot change ability ranks, CPSI or the urgent ability queue.
- Rank denominators use observed values. Coverage and limited-rank flags remain
  explicit; ties are preserved rather than broken into invented certainty.
- Newcomers, jumps and NAR are unsupported by this standard JRA-flat module.

The fixed review-priority points and rank quantiles are research hypotheses.
They have not been calibrated on unseen races and do not establish improved
forecast accuracy. The Tokyo case was inspected after results; do not promote
these flags using that same case as a holdout.

## POST join boundary

auditExclusionOutcome(preAudit, result, options?) accepts only the actual frozen
PRE object issued by this module in the same process. A WeakMap binds race,
scheduled post, snapshotId and inputFreezeId privately. A forged object, copied
object or JSON-restored report is HOLD. Persisted readback is NOT supported by
this release; a future authenticated receipt/import adapter needs separate review.

Result keys: raceId, organization, snapshotId, inputFreezeId, sourceRef,
acquiredAt, postAt, top3. Scheduled post must equal the PRE binding. The result
must be acquired strictly after post, not in the future, and contain three
unique roster horses. The result source is still caller-supplied/unverified.

Reporting flags for a missing result horse does not imply an improved Final5.
It remains POST_AUDIT_ONLY and notAProspectiveImprovementEstimate=true.

## Cohort / profitability audit

auditJraPostRobustness(input, options?) requires a declared cohort manifest:
{cohortId, declaredRaceIds, selectionRule, registeredAt, evaluationMode}.
evaluationMode is RETROSPECTIVE_REFERENCE or PROSPECTIVE_HOLDOUT.
Exact declared race membership, duplicate rejection and preregistration time
checks reduce accidental selective sampling; external cohort completeness and
registration authenticity are NOT established by caller metadata.

Each race adds organization, snapshotId, inputFreezeId, runId, full roster,
signalSource and resultSource to the original fields.
signalSource uses the PRE receipt binding above. resultSource is
{raceId, organization, capturedAt, sourceRef}, matching resultCapturedAt.
Marks, CPSI rank-one horse and actual top three must belong to the roster.

Ticket amounts are either null or:
{stakeYen, payoutYen, basis, sourceRef, raceId, snapshotId, predictionLayer,
 preCommittedAt, settledAt}.
basis: ACTUAL_SETTLED or REFERENCE_SIMULATION.
Ticket commitment must be at/after the prediction and strictly before post;
settlement must be at/after result capture and not in the future.
Labels do not authenticate a purchase or payout. racesWithVerifiedAmounts is
always zero; racesWithSuppliedAmounts reports the actual input count.

- Missing tickets are not losses; supplied payout zero is a loss with known stake.
- Actual/simulated bases have separate groups; mixed groups have no overall ROI.
- BigInt aggregation rejects total yen outside Number.MAX_SAFE_INTEGER.
- One-decimal ratios use integer rounding; undefined denominators yield null.
- Tail stress reports requested removal and actual removal separately. Empty
  remaining samples have ROI null, never a fabricated zero.
- Report anchor win, anchor top-three and Final5 capture separately, including
  anchorTop3NotWin. These are historical rates, NOT per-horse AI probabilities.
- Sort by scheduled post and race ID for chronological max drawdown.
- Report median payout, daily net/ROI, distinct racing dates, and leave-one-day-out.
  Distinct dates are not proof of statistically independent observations.
- Wave bands <40 / 40..<60 / >=60 and UNKNOWN are fixed diagnostic bins only,
  not official Wave classifications, payout forecasts or expected-value models.

## Unseen-race study before a rule proposal

1. Preserve the original EARLY Baseline and all existing diamond/danger rules.
   In particular, popularity alone never assigns diamonds; low EV alone never
   assigns danger; danger and Final5 marks remain mutually exclusive.
2. Register cohort, module version, review thresholds and a separate deterministic
   seat-displacement policy BEFORE the holdout. This patch does not implement or
   activate that policy.
3. Freeze review evidence and queue before results; retain false-positive queue
   burden, missing-data/HOLD rates, subgroup and date/venue/surface coverage.
4. Compare anchor wins, anchor top-three and winner/top-three capture; separate
   missed-winner prevention from safe seat displacement. Never count extra
   candidates as an automatic increase in five-seat capture.
5. A target of at least 100 future races is an initial operational checkpoint,
   not a statistical guarantee or automatic promotion rule. Multiple days and
   venues, calibration, payout concentration and meaningful uncertainty remain
   necessary. Use a new holdout after any rule/weight revision.
6. No win-role scoring is invented from unavailable pace/position/sustain data.
   Actual win-selection improvement remains UNVERIFIED. Separate trusted PRE
   features and prospective comparisons are prerequisites.

## Verification and deployment boundary

Run the two original-scenario tests and jra-shadow-reviewed-contract.test.mjs.
All named Tokyo-like fixtures and receipts are synthetic/reference only.
Full repository check must be rerun by the existing Patch PR Bridge; local
Chrome / MCP dependency shortages must not be described as a full PASS.
No new workflow, runtime flag, deploy, external write or Production activation
is part of this patch. GitHub integration through Bridge remains a separate
operator step, followed by independent PR audit.
