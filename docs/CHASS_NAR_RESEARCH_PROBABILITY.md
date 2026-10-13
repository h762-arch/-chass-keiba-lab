# Phase131: independent NAR research probability prototype

## Scope and model

`materializeNarResearchProbability(snapshot)` is an offline, pure-read prototype. No runtime imports call it: it does not change Cron, D1, the Viewer, schedules, flags, marks, odds, EARLY Freeze or formal KPI. Its output is not saved or frozen by this patch.

For active runners with scores s_i, define w_i = exp((s_i - max(s))/7). Sequential finishing order uses Plackett–Luce sampling without replacement: each next runner is selected in proportion to remaining weights. Win is w_i / sum(w). Top3 is the exact sum of that runner's first-, second- and third-position probabilities, obtained by enumerating ordered top-three outcomes. No Monte Carlo noise, probability clipping or missing-score fill is used.

The temperature 7 follows the existing Worker ability scale solely as an initial research assumption. It is not fitted or calibrated. Ability score components and scales vary by race; real predictive accuracy, calibration and transfer between tracks are unknown. Score ties with complete evidence naturally give equal model probabilities; missing evidence never gives a uniform fallback.

`win` and `top3` are fractions in [0,1]. `top3` means finishing within three; it is not the payout probability of a place bet, particularly for small fields. For two/three active runners top3 equals 1. Labels explicitly say research-only, uncalibrated and formalKpiEligible=false.

## Input gates and provenance

Require a hash-valid NAR ability snapshot with matching SOURCE/DATA identity, valid pre-race acquisition/calculation time, no downstream layers, 2–30 unique horse numbers, known active/inactive status, at least two active runners, complete finite active-runner scores and evidence schema 1. Each active runner must have at least one parsed past run and at least one retained numeric ability component. These are minimum prototype input checks, not proof of model adequacy or comparable coverage.

Older snapshots without retained evidence HOLD. A missing score/evidence holds the entire race, without probabilities for only a subset. Inactive runners have null probabilities and NOT_APPLICABLE. Extreme weight ranges HOLD instead of applying an artificial probability floor.

Output carries model version, input snapshot hash, race identity, method, fixed temperature and research flags. Repeat calls are deterministic. A separate bridge/versioned immutable artifact will be needed before Viewer display or EARLY use; this module alone is not a Signal Freeze.

## Validation and follow-up

Synthetic tests cover probability sums/range/ordering, score symmetry, small fields, exclusions, input gates, tamper/post-off rejection, permutation/translation invariance, deterministic repeat and maximum field size. These establish mathematical/software behavior, not forecast accuracy.

Next: use newly saved evidence-bearing pre-race snapshots for offline materialization, then evaluate win Brier/log-loss and top3 calibration against results, with chronological out-of-sample splits and track/field-size checks. Real-data evaluation has not been performed. Promotion or production display requires a separately reviewed change. Diamonds/warnings remain governed by the existing evidence policy and are not generated here.
