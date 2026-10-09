# Phase84: NAR integrated prediction evidence review v1

## Purpose and entrypoint

Provide one offline entrypoint that runs the real existing NAR app consumer,
historical pair comparison, class-context counter-review, and a horse-level
evidence-use dossier. This makes the gap between collected features and model
use explicit. It does not fit or promote a new prediction model, change marks,
generate Final5/diamonds/warnings, connect production UI, or certify accuracy.

```js
import {reviewNarPredictionEvidence} from './nar-prediction-review-v1.mjs';
const {comparison,dossier,classReview,review} =
  await reviewNarPredictionEvidence(snapshot, baseline, {indexPolicy});
```

Inputs retain the existing bounded snapshot, explicit race/run/model/runner
baseline and optional explicit raw-index research policy. The retrospective
snapshot version selects the retrospective consumer with its existing timing
and identity validation. No caller-authored consumer traces, dossiers, question
answers or prediction-use claims are accepted. All parents are recomputed.

Return values are deeply frozen. Canonical consumer output and both parent
reviews remain available unchanged. The integrated review's hash covers every
row, source values/refs, usage status, counter-review question, gap and authority
flag. Hash consistency is not independent source/timing authentication.

The existing consumer reads the checked-in app test entrypoint offline. This
new composition introduces no network, Drive, DB, storage write, deployment,
runtime flag or Freeze mutation. Production remains Snapshot/DB-based; direct
Drive runtime is not introduced.

## Horse-level dossier

Each active runner has exactly one row sorted by horse number. It contains:

* Original identity and unchanged before/after existing-model output.
* Existing probability/mark status: uncalibrated shadow output.
* Source feature values and original snapshot source references.
* Consumer stages and separate observed probability/mark, TIME and explanatory
  effects, derived from actual consumer ablation.
* Existing history interpretation and TIME research for that exact horse.
* Shared historical pair coverage and attributable class-review questions.
* Explicit missing factors, available-but-unmapped factors, absent research
  index approval, unknown current going and unresolved validation gaps.

| Usage status | Meaning |
| --- | --- |
| MISSING | Source feature was unavailable |
| PRESENT_NO_OBSERVED_MODEL_CHANGE | Available, but no effect observed in this comparison; the reason distinguishes unmapped, unapproved, and unchanged values |
| EXPLANATION_ONLY | Only explanatory output changed |
| OBSERVED_MODEL_OUTPUT_CHANGE | Probability/mark or TIME output changed; separate booleans identify which |

An ablation checks the WHOLE FIELD output. A feature belonging to one horse can
alter normalized values for others. It is not an authenticated horse-local
causal effect, an independent support, or proof of forecast improvement.
No change in an ablation also does not prove a feature was never mapped: it may
have matched the baseline already. Missing values never become zero evidence.

History interpretation is not re-labelled DECISION_USED for probability merely
because it appears in the dossier. Paired questions appear under both involved
horses, so unique questions and row references are counted separately. There
is no support vote, weighted total, pair winner or revised final ordering.

Every row and the race review remain HOLD. Revised final prediction is
NOT_GENERATED. Known going or shared class labels alone cannot remove HOLD.
Class/pace equivalence, forward performance, calibration and independently
authenticated source/timing remain unresolved. earlyEligible, formalKpiEligible
and productionActivationReady are false. Retrospective evidence stays
RETROSPECTIVE_ONLY; Original Signal and user diamond/warning policy are unchanged.

## Executed archival audit, 2026-10-09

Reused the bounded Phase79 capture and reviewed Phase80 replay input for
20260914-NAR-OI-12. No fresh Drive capture, current odds, pre-off proof or saved
original EARLY forecast was obtained. The baseline remains
PEAK_COURSE_WEIGHT_ONLY_NOT_SAVED_EARLY.

| Audit | Count |
| --- | ---: |
| Active horse rows | 13 |
| Complete unordered pairs | 78 |
| Unique counter-review questions | 41 |
| Horse-row references to those questions | 82 |
| Questions with shared literal class label | 11 |
| Questions without shared literal label | 30 |
| HISTORY families with TIME output effect | 13 |
| HISTORY families with explanatory effect | 13 |
| HISTORY families with probability/mark effect | 0 |
| INDEX families with field-wide probability/mark effect | 13 |

The CONDITION feature is available for 13 horses but unchanged versus this
baseline. PRESSURE, POSITION, PEDIGREE and SIGNAL_RESEARCH are missing for all
13 in this bounded export; this does not establish that the entire Drive master
lacks those data. History passage observations remain in HISTORY, separate from
the POSITION evidence-family source field.

All rows HOLD; consumer output matches the Phase81 historical audit unchanged.
Parent review hashes match Phase82 and Phase83:
`6091f7fda484b5acedcea04ee3fa84b5cdeaa1f11d163cb46cb3fa92e178f24b`
and `bcf414501559f11cc70856bcfe056156e64d0c26be72fd2a20ffdcfaad9a71d4`.
Integrated review hash:
`6b2652e39701b2913b39c79c5bac32be2c310b35c37030e5a5a7bc91bf890137`.
Raw inputs and full audit are separate artifacts, not committed git data.

## Verification and remaining work

12 new tests cover canonical parent equivalence, runner attachment, separate
output effects, explanation-only use, missing/unmapped/unapproved factors,
unique versus duplicated question counts, retrospective handling, tampering,
immutable results and false production authority. Related regression tests and
whole-repository Bridge CI remain required before merge.

This completes integrated research review composition, not the user's final
goal of validated multi-angle probabilities and marks. That requires collecting
the missing pre-off features with provenance and testing a separately versioned
candidate model against an unchanged baseline on forward-held-out data.
Formal EARLY remains HOLD and Production Activation NO-GO.
