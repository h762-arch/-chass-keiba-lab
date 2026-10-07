# NAR pre-mark scenario research v1

Status: isolated research / shadow / Production Activation NO-GO.

## Scope and API

`projectNarScenarioAbilityInput(source)` explicitly selects ability fields from
`{raceId,acquiredAt,race,horses}`. Legacy marks, market, default pace, going and
other fields are omitted. This is a projection, not a source/seal verifier;
callers must supply valid original acquisition inputs. Known top-level/race/
runner result and historical flags are rejected. It is not a recursive forensic
result detector and cannot prove that arbitrary model features are pre-race.

`evaluateNarScenarioPremarkResearch({input,horseNo,now})` accepts only that
strict projection schema, verifies identity, unique runners, pre-post timing,
non-future acquisition and the 60-second acquisition window. It returns a
new deeply frozen assessment referencing the projection SHA-256. No old Signal,
valueMark, popularity, odds or EV can enter the evaluator schema.

Projection source fields: raceId/acquiredAt; raceDate/track/raceNo/postTime;
horseNo/horseName/runningStyle/frameNo/predictedTime/predictedTimeConfidence;
features.distanceFit/courseFit/last3fAbility; evidence.sameDistance/sameTrack/
last3f and optional evidenceSources arrays of opaque past-run IDs. IDs must be
consistent across categories; strings supplied by callers are not authenticated.
The projector expects this source shape and is not wired to Worker responses.

## What this implementation can and cannot decide

It inventories provisional V2 support gates: valid TIME, confidence >=60,
rank <=3 and positive same-distance count; distance/course scores >=70 with
positive relevant counts; closing last-3F score >=70 with positive counts.
Scores/confidence are numeric finite 0..100; counts are positive safe integers.
These gates inventory model estimates, not certified strength or route validity.

WIN_ROUTE and PLACE_ROUTE have separate competition conditions and failure
conditions. Text is an unapproved conditional hypothesis, not a ready scenario.
Missing style or ability evidence means no hypothesis text. Unknown frame,
projected position, pace forecast and horse-specific going remain explicit.

All valid evaluations currently return INSUFFICIENT / REVIEW_REQUIRED, including
complete inputs. Both route validation criteria remain unapproved. No arbitrary
WIN/PLACE threshold is invented. Market policy is not evaluated. No candidateMark
or formal mark is returned. This is a working pre-mark evidence/hypothesis
assessment foundation, not a finished classifier. No ROUTE_CANDIDATE path exists
until separately validated criteria are implemented.

Provenance reports OVERLAPPING_RUNS, UNKNOWN or DISJOINT_RUNS_UNVALIDATED.
Disjoint IDs do not prove statistical independence. Missing/inconsistent IDs do
not get manufactured. strongIndependentSupportCount stays null; two categories
never automatically grant triple diamond.

The SHA-256 binds only the ability projection; it is not an EARLY seal,
assessment hash, authenticated receipt or proof of the real clock. There is no
new sealed-envelope reader, store, Signal composition or production integration.
After the race, saved assessment reading is a later integration task; this API
is for fresh generation and rejects post-time calls.

## Fixed rules and unfinished work

The user's fixed order remains popularity eligibility -> scenario -> ability ->
market -> mark -> Freeze. An external future orchestrator must perform eligibility
first while keeping market fields outside this evaluator. Popularity alone, EV
alone and a winning claim in prose never satisfy a route.

WIN/PLACE validation, strong independent support, EV unit/bet/probability and
threshold, warning fourth-or-worse scenarios and full mark exclusion remain
unapproved/unimplemented here. Initial EARLY composition and atomic persistence
are the next stage. Existing EARLY/Signal must never be rewritten or resealed.

Only this new module, its tests and this document are added. Existing V2, app,
Worker, marks, Freeze, store, D1, localStorage and runtime flags are untouched.
No fetch, timer or storage is called by this module. No live NAR acquisition or
real-data validation was performed for this new evaluator.

## Validation

15 new synthetic-input tests pass. New evaluator + V2 + NAR EARLY related
suite: 87/87 pass. Full local check: 1139/1141 pass; 2 failures are absent
Chromium and missing MCP SDK. Full PASS must not be claimed from local results.
The Bridge CI result is not known at patch preparation time.

Tests cover legacy-market invariance, schema contamination, distinct competition
conditions, unapproved criteria, no auto mark, missing/negated style, numeric
boundaries, shared/unknown/disjoint provenance, unknown race context, identities,
calendar dates, timing, result flags, source immutability and deterministic hashes.

The 18:10 design's first 8 acceptance requirements are addressed structurally;
full route certification is deliberately held. Requirements 9-15 concerning
initial composition/seal/storage are not implemented by these tests.

Reference main: e667ccb5a1cb142ed877d53cdbd0d8128b1ba4f4 (PR #133).
Primary user rule source: uploaded "⚠️と💎の取り扱いルール.txt".
