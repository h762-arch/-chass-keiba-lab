# Phase83: NAR class-context counter-review v1

## Purpose

Narrow Phase82 index-led raw-history divergence questions by exact historical
class-label strata. Apparent disagreement can change after conditioning on
class labels; an unadjusted median must not be treated as a validated reason to
reverse predictions. This offline module creates traceable review material,
not a new model, app UI connection, class hierarchy, or completed final review.

```js
const dossier = await buildNarMultiAngleComparison(snapshot, comparison);
const review = await buildNarClassContextReview(snapshot, comparison, dossier);
```

The new function is exported from `src/research/nar-class-context-review-v1.mjs`.
It recomputes the canonical parent dossier and compares hashes of the COMPLETE
supplied/recomputed objects. Rehashing a forged or incomplete dossier cannot
attach fabricated questions. Parent snapshot, comparison output, identities,
history dates and research flags retain Phase82 validation. No input is mutated.
The result is deeply frozen and includes snapshot, comparison and parent review
hashes plus its own content hash. Hashes establish consistency, not source
authentication, timing proof, approval, or model calibration.

## Label matching and scope

Only outer whitespace is trimmed. Blank, UNKNOWN, UNK, N/A, null, missing, '-'
and 不明 labels are missing, never a shared class bucket. Every other label must
match literally. For example, B3二 does NOT automatically equal 三宅坂賞B3二,
B3一, B3, or any inferred class family. Original Drive text is not rewritten.
Same-label history is NOT authenticated equivalent race strength.

Each parent question retains its pair, model leader, smaller-observation horse,
axis, historical going and original question index. Its axis-specific source
references determine the eligible observations. Therefore course, exact
distance, dirt surface, known going, time/closing validity and finish-denominator
checks cannot be relaxed by the class review. Source refs preserve original
snapshot history positions, dates and literal class labels.

For each shared label the module recomputes the Phase81 median observation:
clock seconds, last3F seconds, or finish fraction. Position gain never becomes
an ability question. It records both values, counts, refs, direction, signed
A-minus-B delta and single-observation status.

| Status | Meaning |
| --- | --- |
| NO_SHARED_USABLE_CLASS_LABEL | No shared usable literal class label for this axis |
| RAW_DIVERGENCE_PERSISTS | The parent's smaller raw observation remains smaller |
| RAW_DIRECTION_REVERSES | The direction reverses within the shared-label subset |
| RAW_TIE | Equal raw observations within the subset |
| MIXED_RAW_DIRECTIONS | Shared-label strata have different relations |

No majority vote, aggregate winner, new rating, mark/probability change or
class/pace adjustment is computed. Counts of questions are correlated and must
not be reported as independent supports. Missing labels, unmatched labels and
small samples remain visible. Known historical going does not fill current
going. Current race class is NOT_ASSESSED: neither the target class nor its
equivalence can be inferred from these historical labels.

## Unresolved evidence and authority

Race pace/laps are unavailable in the current projected input. Clock, last3F,
class label or retained passage positions cannot prove a pace match. Every
question therefore remains
UNRESOLVED_PACE_CLASS_EQUIVALENCE_AND_FORWARD_VALIDATION and
predictionChangeAllowed=false, including a raw direction reversal.
Period, opponents, selection bias, class equivalence and forward performance
remain unverified. Exact-label conditioning does not establish causality.

Existing probability/mark/TIME/history interpretation and the Phase82 dossier
are unchanged. No production runtime, Drive runtime, DB, flags, deployment,
Original Signal, Freeze, diamonds/warnings or Final5 is changed. Formal EARLY
remains HOLD and Production Activation NO-GO. Output earlyEligible,
formalKpiEligible and productionActivationReady are always false. Retrospective
mode remains retrospective; no late result evidence is backdated as pre-off.
User diamond/warning rules remain unchanged.

## Executed archival audit: 2026-10-08

Reused Phase79 bounded capture and Phase80 identity review for
20260914-NAR-OI-12. No fresh Drive read, market collection, pre-off acquisition
or original saved EARLY prediction is claimed. The Phase82 parent dossier and
consumer output were reproduced unchanged before the new review.

| Audit | Count |
| --- | ---: |
| Parent questions | 41 |
| Questions with shared literal class label | 11 |
| Questions without shared label | 30 |
| Shared-label strata | 11 |
| Raw divergence persists | 10 |
| Raw direction reverses | 1 |
| Strata with at least one single observation | 10 |

Checks: 11 + 30 = 41 questions; 10 + 1 = 11 strata. These are descriptive,
correlated observations, not 11 proven class-equivalent comparisons or validated
prediction corrections. Current going is UNKNOWN and pace is UNAVAILABLE.

Review hash:
`bcf414501559f11cc70856bcfe056156e64d0c26be72fd2a20ffdcfaad9a71d4`.
Parent review hash:
`6091f7fda484b5acedcea04ee3fa84b5cdeaa1f11d163cb46cb3fa92e178f24b`.
Raw archival data remains in the separate audit artifact, not the git patch.

## Verification and remaining gate

12 new tests and 68 related tests pass (80 total). They cover literal-label
matching, missing labels, class-conditioned reversal/tie/mixed directions,
original history refs, invalid finish denominators, immutable parent outputs,
forged/rehashed/incomplete dossiers, unavailable pace and false authority flags.

Whole-repository Bridge CI and exact PR diff audit are required before merging.
This implementation does not constitute an approved multi-angle prediction
model. Model integration still requires explicit class-equivalence/pace evidence
where used, pre-off feature provenance, and forward validation.
