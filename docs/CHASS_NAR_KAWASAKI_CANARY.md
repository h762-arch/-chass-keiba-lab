# Phase127: same-day Kawasaki research canary activation

This patch enables the Phase126 NAR ability path for Kawasaki (code 21) only,
for JST 2026-10-13 until 14:55 JST. The first official race observed is 15:00.
No all-venue rollout, new D1 schema, probability/EV/Signal generation, formal
EARLY adoption or Drive write is authorized by this configuration.

## Effective settings after merge/deploy

- ENABLE_NAR_ABILITY_PRECOMPUTE=true
- ENABLE_NAR_ABILITY_VIEWER=true
- NAR_PRECOMPUTE_TRACK_CODES=21
- NAR_PRECOMPUTE_MAX_JOBS=3
- NAR_PRECOMPUTE_BUDGET_MS=20000
- NAR_PRECOMPUTE_CANARY_DATE=2026-10-13
- NAR_PRECOMPUTE_STOP_AT=2026-10-13T14:55:00+09:00

Only merging/deploying this patch applies these settings. No direct production
configuration change or D1 write was performed while preparing it. If applied
late, it safely skips rather than carrying activation into the next day.

The runner now requires a valid explicit canary date and stop timestamp within
that JST date. Wrong-day/expired calls return CANARY_WINDOW_CLOSED before D1
or source work. Missing/invalid canary fields block. The effective processing
budget is the smaller of the per-run deadline and stop time, checked before
new card acquisition and save start. A D1 operation already in flight is not
cancellable by this guard; the boundary is new work initiation, not transaction
completion. Viewer reads remain available for retained records after expiry.

Existing result collection and JRA precompute/market queue retain priority.
When at least three automatic results were processed, NAR returns
AUTO_RESULT_PRIORITY without fetching. JRA MARKET queue runs before NAR.
JRA maxJobs=1 and maxPlanningJobs=4 remain unchanged.

## Read-only verification

New GET/HEAD route:

`/api/chass/v1/public/nar-precompute-status?date=2026-10-13`

This route reports enable/window state, schema readability, verified saved race
count and per-race runner/ability/TIME counts. It queries at most 500 versioned
NAR rows and verifies the stored snapshot hash, identity and pre-off source time.
No source fetch, database write or schema repair occurs. Invalid dates return
400. An unreadable schema yields schemaReady=false and savedRaceCount=null,
never a guessed zero. Counts are saved coverage, not the number of all scheduled
races: compare with official RaceList and inspect CHASS NAR PRECOMPUTE logs.
Unselected/HOLD reasons remain in those logs, not a durable D1 attempt table.

After successful deploy, verify status schemaReady=true and active=true, then
allow the existing five-minute Cron to run. Inspect saved count and race list,
and open Viewer at date 2026-10-13 / NAR / Kawasaki. A selected date/track with
some new rows uses the new ability-only reader rather than mixing legacy
probabilities. All records are research-only; formalKpiEligible=false.

Stop/rollback: set ENABLE_NAR_ABILITY_PRECOMPUTE=false to stop new work;
set ENABLE_NAR_ABILITY_VIEWER=false to return to the legacy Viewer reader.
Do not delete retained snapshots. After automatic expiry, wider activation
requires a separate reviewed configuration change.

Seven new tests verify date/expiry/mid-run stop, read-only status/HTTP method
policy, invalid schema/date, exact production canary settings and task priority.
Related runner tests use an in-memory D1 double. Production saved counts and
throughput remain unverified until this patch actually deploys and Cron runs.

Full repository check: 1,787/1,787 PASS. Related NAR tests: 24/24 PASS.
