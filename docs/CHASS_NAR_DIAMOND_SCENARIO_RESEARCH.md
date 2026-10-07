# NAR diamond scenario research

Version: NAR-DIAMOND-SCENARIO-RESEARCH-2

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
hash and independently evaluates the saved generation time, research flags,
runner, source Signal, evidence, targets and narrative against the sealed source.
Readback accepts an unchanged pre-post assessment after the race; it does not
use the current read clock as the generation clock. It rejects self-consistent
hashes with inconsistent semantics. This remains an integrity/contract check,
not authentication, proof of the real generation clock, or predictive accuracy.
V1 records are not silently migrated or resealed; their V1 schema is rejected.

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
Scores and TIME confidence must be finite values within 0..100. Supporting
run counts must be positive safe integers. Invalid values are excluded rather
than clamped or rounded. Style must exactly match an explicit supported label;
negations, unknown qualifications and mixed front/closing prose cannot supply
style evidence. The app's observed labels `先行・好位`, `逃げ・先行` and
`差し・追込` remain supported.
Triple diamond requires two support categories. Distance and course scores
may be correlated; multiple categories do not prove independent evidence.
Calibration and walk-forward efficacy remain unverified.

Style-based conditions are hypotheses, not observed race facts. Unknown frame
is omitted, unknown projected position/pace/going suitability is listed. There
is no invented inner-frame advantage, exact corner position or two-horse duel.
The available numeric evidence makes a hypothesis inspectable, but does not
prove that the hypothesised race development is likely or the horse will win.

## Validation

19 synthetic-source tests (the original 9 plus 10 regression tests) cover
front/closing routes, unsupported/negated styles, bounded numeric evidence,
integer counts, correct boundary evidence, post-generation rejection,
rehashing with semantic inconsistency, source immutability and normal
post-race readback. Related scenario/EARLY tests: 72/72 pass.
Full local check: 1124/1126 pass; Chromium is absent and the MCP SDK dependency
is missing. These environment failures are not labelled full PASS.

V1 historical validation (not repeated for V2): a separate live research capture was acquired on 2026-10-07 at
03:33:25.798Z (12:33:25 JST), Sonoda race 7, official post 13:50.
It used real Worker data and the real clock, one HTTP request and memory
storage only. Two currently marked runners yielded SCENARIO_READY and VERIFIED;
the source snapshot remained unchanged and UI state was restored. This later
diagnostic capture does not replace the earlier 12:25 Signal audit. The full
source snapshot and assessments are retained in the user-facing live report.

Production D1, formal KPI promotion, prediction performance, later-market
integration and complete mark-policy certification remain unverified/on hold.
