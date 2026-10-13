# Phase130: NAR ability evidence and missing-value audit

## Problem and scope

NAR precomputed DATA previously kept score/rank/TIME but discarded upstream parsed-history counts, index components and TIME missing reasons. Existing Worker `abilityWinRate` uses a score exponential with clipping; this change does not promote it to calibrated or formal probability.

## Change

Newly saved horses receive an optional `evidence` schema version 1: parsed run count, exact-distance/track counts, up to ten recent indices, four numeric ability components, TIME type/confidence and known upstream TIME missing reason. Only named fields are projected. Raw histories, arbitrary feature objects, odds, popularity and upstream probability are not copied.

The existing calculation/model identifier is retained because the ability/TIME calculation algorithm is unchanged; optional evidence has its own schema marker. Existing snapshots remain immutable and are not backfilled or re-fetched. New evidence enters the normal snapshot hash.

The read-only status endpoint and NAR day/race API expose per-race `quality`: total/active horses, active ability/TIME counts, evidence retention count, ability completeness and per-horse reason codes. Ability completeness requires at least two active horses with scores; it is not probability readiness or model validation.

Known missing TIME reasons are retained exactly. Missing historical evidence is `EVIDENCE_NOT_RETAINED`; unknown new upstream TIME reasons are `TIME_REASON_UNAVAILABLE`. Neither is guessed to mean no history. All probabilities stay null with `MODEL_HOLD / PROBABILITY_MODEL_NOT_CONNECTED`, even when ability coverage is complete.

## Unchanged runtime

No daily schedule, track, cap, budget, Cron, Viewer layout, market layer, marks, diamonds, warnings, formal KPI or Signal changes. No schema migration, deploy or production D1 writes during patch preparation. Today’s previously saved data will report evidence not retained; this is an accurate limitation rather than a failed acquisition.

## Verification and next step

Tests exercise bounded projection, upstream reason preservation, old evidence absence, active-runner counts, null probability and read-only API/persistence integration. Full repository checks and exact-base apply check must pass before Bridge audit.

After merge, audit today’s older rows for explicit unretained evidence; after the next successful new acquisition, verify evidence retention and actual missing reasons. Probability model selection/calibration remains a separate research task; no synthetic percent fill is introduced here.
