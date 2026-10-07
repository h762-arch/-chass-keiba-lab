# NAR diamond scenario research

Version: NAR-DIAMOND-SCENARIO-RESEARCH-1

This is an isolated shadow assessment. There is no app/Worker wiring, fetch,
timer, storage, production flag change or mark assignment. Production
Activation remains NO-GO. Merge and production adoption remain on hold.

## Source and timing

`buildNarDiamondScenarioResearch({snapshot,raceId,horseNo,now})` accepts a
verified CHASS-NAR-EARLY-1 source. It uses only its prediction and frozen
market/Signal fields. The source must have been captured before the current
clock; generation must be strictly before the saved post time. Post-race
generation and source hash mismatch are rejected. Current going or default
pace is not used to invent horse-specific suitability or a pace forecast.

The assessment holds sourceEarlySha256, sourceCapturedAt, generatedAt,
the exact sourceSignal, evidence paths, conditional hypotheses, failure
conditions, unknowns and its own SHA-256. The returned object is deeply
frozen. `verifyNarDiamondScenarioResearch` checks the source link and content
hash; this is an integrity check, not authentication or predictive accuracy.

It is a separate research record, not a retroactive addition to the existing
EARLY snapshot. The original EARLY and its mark are not rewritten/resealed.
Formal future composition must generate and include the assessment in the
initial acquisition/Signal operation before initial sealing. That wiring is
not implemented here. Do not claim the existing production Signal now contains
this narrative or that full mark-rule conformity has been approved.

## Assessment

- SCENARIO_READY: an unambiguous style and sufficient model support can form
  a conditional route to the existing mark's target (2-3 for diamond, 1 for
  double/triple diamond).
- INSUFFICIENT: no scenario text, explicit missing reasons, REVIEW_REQUIRED.
  High EV alone does not supply missing style or ability evidence.
- REJECTED: source, timing, runner or frozen-market policy inconsistency.

No status assigns, upgrades or removes a diamond. In particular,
SCENARIO_READY means a research narrative can be inspected, not permission
to adopt a mark in production. The popular-rank filters mirror the frozen
source policy; the existing production thresholds and Freeze logic are untouched.

Research support gates are explicit provisional heuristics: same-distance
TIME with confidence >=60 and input rank <=3; distance/course scores >=70
with relevant run counts; closing ability >=70 with last-3F run evidence.
Triple diamond requires two support categories. Distance and course scores
may be correlated; multiple categories do not prove independent evidence.
Calibration and walk-forward efficacy remain unverified.

Style-based conditions are hypotheses, not observed race facts. Unknown frame
is omitted, unknown projected position/pace/going suitability is listed. There
is no invented inner-frame advantage, exact corner position or two-horse duel.
The available numeric evidence makes a hypothesis inspectable, but does not
prove that the hypothesised race development is likely or the horse will win.

## Validation

9 new synthetic-source tests cover front/closing routes, 2-3 target, missing
and ambiguous styles, missing evidence, unknown contextual inputs, post-race
rejection, source-policy rejection, source immutability and narrative tampering.
Related EARLY tests: 28/28 pass. Full local check: 1114/1116 pass, with
CHASS_BROWSER_SMOKE_CHROME_NOT_FOUND and missing MCP SDK dependency failures.
These environment failures are not labelled full PASS.

A separate live research capture was acquired on 2026-10-07 at
03:33:25.798Z (12:33:25 JST), Sonoda race 7, official post 13:50.
It used real Worker data and the real clock, one HTTP request and memory
storage only. Two currently marked runners yielded SCENARIO_READY and VERIFIED;
the source snapshot remained unchanged and UI state was restored. This later
diagnostic capture does not replace the earlier 12:25 Signal audit. The full
source snapshot and assessments are retained in the user-facing live report.

Production D1, formal KPI promotion, prediction performance, later-market
integration and complete mark-policy certification remain unverified/on hold.
