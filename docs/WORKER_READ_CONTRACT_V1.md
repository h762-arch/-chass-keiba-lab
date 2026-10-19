# Worker Original / Signal read contract v1

Base: PR #262, main cbc07e74379aaecb443f2064cdc04afe6fafabf9,
tree 25a2684121c6403031de6b0e109a498c06cc0566.
Verified prior Bridge CI: 3369 tests, 3369 pass, 0 fail, 0 skip.

## Scope and ownership

The AI Bridge and saved-record public readers share bridgeOriginalHorses.
Prediction owns horse identity, ability, probabilities, TIME and ability axes.
Market joins only named display/market fields, never an unrestricted spread.
FINAL joins only mark/rank/finalScore/score. It cannot overwrite ability.
The pace-fit ability alias is resolved from Prediction, independently of
Market's similarly named longshot research component.

This is a read projection, not prediction reimplementation or signal generation.
app.js is unchanged. Tests execute its actual frozenHorses reader in a VM and
compare Signal behavior with the Worker. The Worker intentionally suppresses
legacy conflicting warning/selection/diamond display aliases as well.
The implementations remain separate; these tests check their contract, not
complete semantic equivalence for every legacy record.

## Frozen signals

Only status=frozen adopts saved value marks, including explicit empty marks.
A pending snapshot is not promoted. warningFrozenAt can restore a warning alone.
Any displayed warning suppresses selection/ability/diamond aliases, including
FINAL and the original reference attached to Live. Saved bytes are untouched.
Unfrozen free-text reasons are not reused as the reason for a frozen signal.
No new reason is generated; absent supported reason text remains null.
This change does not validate or regenerate popularity/scenario/ability evidence
for existing signals. Full signal-rule compliance requires original evidence.

## Binding, missing data and status

Explicit incompatible raceId/modelVersion/organization bindings on Market,
FINAL, Result or Validation are excluded from the read projection.
An excluded Result also excludes Validation; excluded Validation clears the
derived validated flags. Missing legacy labels are neither invented nor
rejected. Prediction identity conflicts, resultQueue state semantics and every
historical-similarity reader are outside this batch's complete audit claim.

Missing/blank/boolean/array/object/nonfinite numeric input becomes null,
not zero. Genuine 0 and numeric strings remain valid; existing numeric
probability scaling/clamping is unchanged and is not a model calibration.
Low-confidence scratch is unknown and excluded from confirmed scratch counts.
Confirmed exclusion remains status-only; valid bound result participation can
reconcile it. No Live adjustment is recomputed or enabled.
Returned nested data is cloned so callers cannot mutate saved input.

## Research metrics

Research and volatility readers use the same layer-binding filter.
Model version keys use a dictionary without an inherited prototype, including
literal "__proto__", "constructor" and "toString" keys.
Metrics remain retrospective reference metrics, not formal EARLY KPI.
No result/validation flags or seal establish acquisition authenticity.

## Verification and limits

Synthetic fixtures only: ownership, app/Worker Signal contract, empty freeze,
pending/warning-only cases, alias exclusion, missing numeric values, layer
bindings, runner state, clone isolation, public GET paths, and model key safety.
Fake D1 rejects every statement except SELECT/WITH and rejects batch writes.
The existing public tests now require warning/diamond exclusivity rather than
expecting contradictory simultaneous display.

No real D1/localStorage writes, existing-data repair, live acquisition, Smoke
retry, historical replay, EARLY Freeze, runtime flag change, merge or deploy.
Original snapshots, saved signals, prediction formulas and app.js are unchanged.
Production revision/behavior and real-browser visual behavior are unverified.
Real evidence/result ledger copies, provenance and the comparison log audit
remain outstanding. No accuracy, ROI or original live-error resolution claim.
Formal KPI HOLD / Probability MODEL_HOLD / Production Activation NO-GO.
