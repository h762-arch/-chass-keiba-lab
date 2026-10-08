# Phase82: NAR multi-angle historical comparison dossier v1

## Purpose and authority

Turn Phase81 history interpretation into attributable horse-to-horse comparison
material for prediction review. This is an offline research composition, NOT a
replacement prediction model, Final5 selector, or production app UI integration.
It never edits probabilities, ability marks, TIME, weights, role decisions,
Original Signals, Freeze, Drive, DB, runtime flags, or deployments.

Formal EARLY remains HOLD and Production Activation remains NO-GO. A dossier
always has earlyEligible/formalKpiEligible/productionActivationReady false.
Past results used for historical identity review remain hindsight-exposed;
resolving identities does not authenticate pre-off availability.

## Interface and bindings

```js
import {replayNarMasterEvidence} from './nar-retrospective-replay-v1.mjs';
import {buildNarMultiAngleComparison} from './nar-multi-angle-comparison-v1.mjs';
const replay = await replayNarMasterEvidence(reviewedArchiveInput);
const dossier = await buildNarMultiAngleComparison(replay.snapshot, replay.comparison);
```

Both declared pre-off and retrospective research snapshots are accepted with
their existing distinct versions and false formal/production eligibility.
Snapshot content hash, race organization, comparison snapshot/run/model binding,
comparison output hash and complete active-runner identity must match. The
retrospective schema must remain RETROSPECTIVE_ONLY and earlyEligible false.
All prior-history dates are revalidated, even when there is no comparable pair.

Hashes establish internal consistency only, NOT independently authenticated
source, feature timing, certified probabilities, or approval. The parent
consumer retains its existing timing/source/identity validation responsibilities.
The dossier's `reviewHash` includes its complete content and provenance bindings.
Inputs are immutable and the returned dossier is deeply frozen.

## Comparative dimensions

Every unordered active-horse pair is retained, including pairs with no shared
usable condition. Horse-number sorting makes pair identity/order deterministic.
For 13 runners the field contains `13 * 12 / 2 = 78` unordered pairs.

Only exact target course, exact target distance, dirt history, and the SAME known
historical going (良/稍重/重/不良) may be compared. UNKNOWN is never guessed.
There is no near-distance conversion, cross-course pooling, or cross-going blend.
Current going is not filled from historical conditions or final result going.
`matchesDeclaredCurrentGoing` is just a source-declaration match, not proof of
the actual current condition. In the actual audit it is false for every context.

| Axis | Observation | Boundary |
| --- | --- | --- |
| CLOCK_SECONDS | Median exact-context clock seconds | No pace/class/going correction |
| LAST3F_SECONDS | Median exact-context final 3F | No race-pace correction; correlated with total clock |
| FINISH_FRACTION | Median `(finish-1)/(fieldSize-1)` | Descriptive rank fraction, not an ability/probability score |
| RECORDED_LATE_POSITION_GAIN | Median last retained passage minus finish | More gained positions does NOT mean stronger ability or a better finish |

Dimensions inherit Phase81's valid-result, passage and time checks. Missing
values are omitted, not replaced with zero, an inferred clock, or a theoretical
winning scenario. References map filtered historical-going subsets back to the
ORIGINAL snapshot history positions. Original Drive rows remain available in
the parent's evidence/adapter audit.

Each comparable axis reports both values, sample counts, units, refs, signed
delta A-minus-B, direction (A_LOWER/B_LOWER/TIE) and single-observation status.
Lower raw time/finish fraction does not establish higher race-adjusted ability.
There are no weighted sums, independent evidence votes, aggregate pair winners,
new ratings, inferred pace scenarios, role changes, diamonds, or warnings.

## Rebuttal material

Existing app `overall` identifies an index-led model order only when both values
are finite and unequal. If the other horse has the smaller historical clock,
last3F, or finish fraction within a shared context, a structured
`REVIEW_INDEX_LED_RAW_HISTORY_DIVERGENCE` question is recorded. A null/tied model
order creates no invented leader. Position gain is NEVER used to question who
is stronger. Questions cannot authorize any prediction change.

This is preliminary material for an adversarial review, not a completed review
or a conclusion that the existing order is wrong. Race class, race flow, course
configuration, period, opponents and historical selection can explain apparent
disagreement. Questions therefore remain UNRESOLVED_CLASS_PACE_CONTEXT.
Clock, last3F and finish dimensions overlap; their counts cannot be presented as
independent supports. One-observation comparisons are explicitly marked.

User diamond/warning policy and Original Signal immutability are unchanged.
No popularity-only, low-EV-only, raw-history-only or index-only signal is created.

## Executed historical audit, 2026-10-08

Phase79 bounded capture and Phase80 historical identity review were reused.
No new Drive read, current-market acquisition, or pre-off capture is claimed.
The Phase81 parent output is reproduced unchanged before creating the dossier.

| Audit | Observed value |
| --- | ---: |
| Active runners | 13 |
| Complete unordered pairs | 78 |
| Pairs with at least one shared usable historical-going context | 32 |
| Pairs without shared usable context | 46 |
| Shared contexts across comparable pairs | 41 |
| Review questions | 41 |
| Clock questions | 11 |
| Last3F questions | 16 |
| Finish fraction questions | 14 |
| Position-gain ability questions | 0 |
| Axis comparisons involving a single observation | 116 |
| Contexts matching declared current going | 0 |

The 41 questions are NOT 41 independent proofs, prediction failures, validated
reversals, or accuracy improvements. Current going remains UNKNOWN. All parent
probability/mark/TIME/history-interpretation outputs remain unchanged.

Dossier hash: `6091f7fda484b5acedcea04ee3fa84b5cdeaa1f11d163cb46cb3fa92e178f24b`.
Snapshot hash: `1a841d67cbf1348f6a1447497026e64ea0718d895dd164746b96ad620eaa777d`.
The separate audit artifact retains input, parent output, dossier, individual
questions, source associations, execution time and test records. Raw historical
data or results are not committed to the repository.

## Verification

```sh
node --test tests/nar-multi-angle-comparison-v1.test.mjs \
  tests/nar-history-interpretation-v1.test.mjs \
  tests/nar-retrospective-replay-v1.test.mjs \
  tests/prediction-evidence-bridge-v1.test.mjs \
  tests/nar-prediction-evidence-consumer-v1.test.mjs \
  tests/nar-master-evidence-adapter-v1.test.mjs
```

13 new tests and 55 related existing tests pass. Whole-repository Bridge CI and
exact PR diff review remain mandatory before merging. Future work must connect
this material to an explicitly versioned prediction-review decision with
forward evidence; descriptive divergence alone cannot promote a model or Signal.
