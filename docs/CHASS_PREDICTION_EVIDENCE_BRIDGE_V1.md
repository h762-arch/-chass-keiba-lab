# Phase77: CHASS Prediction Evidence Bridge v1

Research candidate; Production Activation NO-GO and formal EARLY HOLD.

## Outcome and limits

Offline exports of CHASS_UNIFIED_RACE, CHASS_UNIFIED_RUNNER_EARLY and
CHASS_UNIFIED_HISTORY become a hash-bound, immutable Prediction Evidence
Snapshot keyed by CanonicalRace_ID, CanonicalHorse_Key, explicit Run_ID and
ModelVersion. No Drive reader, OAuth, Worker wiring, database write or deployment
is introduced. Production integration remains Snapshot/DB only.

`createPredictionEvidenceSnapshot` accepts bounded array tables (header first),
source spreadsheet/revision/exportedAt/availableAt, an explicit pre-off cutoff,
and an independently supplied identityMap. Caller declarations are retained as
UNVERIFIED source/timing and CALLER_DECLARED identity: they are never formal
source authentication or trusted durable timing. A snapshot hash detects changed
content, not forged provenance. Retrospective exports alone cannot prove EARLY.

TEMP keys are not silently resolved by horse number or name. Every exact
race/key/number/name must have one explicit PASS identity mapping with evidenceRef.
CancelStatus must explicitly be ACTIVE, SCRATCHED or EXCLUDED. UNKNOWN holds.
Duplicate keys/numbers/history slots, future/current history dates, missing race
surface/distance, late source availability and missing versions fail closed.

## Source fields inspected on 2026-10-08

Canonical spreadsheet:
https://docs.google.com/spreadsheets/d/1dqFySEgG6cYEXIx8BmOw7tPOe7wI90H_No1FRoXlgoI/edit

Metadata and exact bounded ranges were read: CHASS_UNIFIED_RACE A1:AD3,
CHASS_UNIFIED_RUNNER_EARLY A1:CM3, CHASS_UNIFIED_HISTORY A1:AM3.
These are schema/sentinel reads, not a full archive audit. The first two runner
rows have TEMP identities, UNKNOWN CancelStatus and partial coverage; sampled
race rows lack Surface/DistanceM. They do not establish valid production inputs.

| Family | Snapshot handling | Existing consumer in this version |
| --- | --- | --- |
| History: course, distance, finish, time, closing 3F, passage, carried weight | Structured pastRuns, at most 10 | JRA calculateJraData in isolated comparison |
| Current carried weight | Numeric value, missing stays null | JRA calculateJraData in isolated comparison |
| Index: peak/average/distance/course/prior 1-3 | Preserve raw scale | No scale mapping; not used |
| Pressure/position | Preserve declared research fields | Not used |
| Pedigree coverage | Coverage metadata only, not pedigree ability evidence | Not used |
| Prior signal research notes | Inspection-only provenance | Not used to assign marks |
| NAR feature snapshot | Same source contract | HOLD: NAR_CONSUMER_NOT_CONNECTED |

No synthetic 0-100 conversion of raw indices and no new weights are introduced.
Existing JRA calculator behavior and weights are reused unchanged. Its output
probabilities remain EXISTING_MODEL_UNCALIBRATED. No claim of better accuracy,
calibration, profit or formal marks follows from this patch.

## Actual consumption trace

`comparePredictionEvidence(snapshot, baseline)` checks content hash and exact
race/run/model context plus active key/number identities. It copies the baseline,
projects available history and weight, then executes the existing JRA calculator.
Missing history/weight never erases available baseline evidence.

AVAILABLE -> INSPECTED -> INTERPRETED -> PROPAGATED -> COMPARED -> DECISION_USED

Each mapped family is ablated back to that horse's baseline field while keeping
the other candidate fields. Only an observable calculator output hash change
records DECISION_USED. Equal output remains COMPARED with
NO_OBSERVED_MODEL_OUTPUT_CHANGE. This is operational influence on model output,
not proof that the evidence improved a final decision. Unsupported families stay
INSPECTED with an explicit unused reason. Source presence/export never grants use.
A missing family has no AVAILABLE event. Result contains before/after, output
hash, family ablation hashes and source row/revision references. Inputs are not
mutated. Current market, historical popularity, previous marks/probabilities,
FINAL conditions and current-race result are excluded from core input.

## Signal policy and immutable decisions

User-supplied CHASS diamond/warning fixed rules v1.0 remain authoritative:
warning requires popularity 1-3 when pre-race odds exist and a concrete fourth-
or-worse scenario; single diamond requires popularity >=6, second/third scenario,
ability and market value; double requires >=6 and winning scenario; triple
requires >=9, winning scenario and multiple strong supports. Popularity alone
never assigns a diamond; low EV alone never assigns warning. Warning excludes
all five prediction marks. Original Signal stays frozen; later changes belong to
Live Assessment. This bridge generates neither marks nor signals and performs
no Original Signal mutation. Market/signal consumers require a separate validated
composition; no rules are claimed executed merely by storing notes here.

## Next acceptance work

This is the first isolated exporter/consumer comparison, not a complete app
connection. Next: resolve current NAR identities/status/context and authenticated
pre-race source revisions; connect a NAR-specific consumer without substituting
the JRA model; implement scale-approved index and additional feature-family
consumers; validate forward cohorts and calibration; then review Snapshot/DB
runtime adoption and EARLY Freeze eligibility. Keep Ticket gates separate.

Tests cover real execution of the existing JRA calculator with synthetic bridge
fixtures, ablation tracing, missing/late data, identity/version/hash mismatch,
result leakage and market exclusion. No production writes are used.
