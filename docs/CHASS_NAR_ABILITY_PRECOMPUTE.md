# Phase126: NAR autonomous ability precompute and Viewer bridge

## Scope and activation

Adds a NAR-specific scheduled runner and a read-only precomputed Viewer reader.
Both switches default OFF; this patch changes no production configuration or
D1 schema. Existing JRA planning and MARKET limits remain untouched. It uses
`precomputed_race_snapshots` with organization NAR and exact version
NAR_ABILITY_PRECOMPUTE_V1, isolated from app-saved races and JRA identities.

This phase displays ability scores/ranks and available actual-run-derived TIME.
It does NOT materialize AI win/place probability, EV, marks, diamonds or warnings.
It does NOT establish formal EARLY eligibility or Signal Freeze. Its public
payload and Viewer notice explicitly identify research-only ability data.
Missing probabilities remain missing rather than becoming uniform probabilities.

Example canary configuration AFTER PR/CI and deployment verification:

- ENABLE_NAR_ABILITY_PRECOMPUTE=true
- ENABLE_NAR_ABILITY_VIEWER=true
- NAR_PRECOMPUTE_TRACK_CODES=21 (Kawasaki)
- NAR_PRECOMPUTE_MAX_JOBS=3
- NAR_PRECOMPUTE_BUDGET_MS=20000

These are examples, not changes made by this patch. Explicit venue codes are
required, at most three; jobs cap 1–4 and network/planning budget 1–30 seconds.
Banei code 3 is intentionally excluded: the thoroughbred ability/TIME model
must not be silently applied to Banei. Broader rollout requires throughput and
source coverage measurements; this is not a guarantee of all-country completion.

## Pipeline and boundaries

Cron finishes existing tasks, then runs NAR separately when enabled. Discovery
uses official RaceList for configured venues/date (JST). Unknown meetings are
not interpreted as non-meetings. Every confirmed real race is inspected for
existing snapshots; saved races are excluded before candidate selection.
Unsaved candidates rotate with the Cron turn. Every attempted/HOLD candidate
consumes an attempt slot; subsequent candidates are reached through rotation.
There is no dependence on JRA DATA inspection/planning candidates or its maxJobs.

Only official DebaTableSmall is fetched for a card: no odds or result-page
request, no server fetch retry. Requests race a maximum 5-second timer across
fetch and stream receipt, are limited to 1 MB, reject redirects and decode
UTF-8 strictly. Current header identity must match date/venue/race, including
NFKC/spaced-venue normalization observed on the official page. Existing NAR
past-run parsing and ability scoring are reused; no alternate market-as-ability
calculation is introduced. At least two active scored runners are required.
Missing TIME remains null. Race context, horse identity, known post time and
pre-post receipt/save-start checks are mandatory.

First save is a conditional revision-1 INSERT OR IGNORE. Existing records are
never overwritten; save readback checks the snapshot hash. This immutable
research DATA is not a signed/trusted Signal Freeze. Query/readback failure
must not be interpreted as successful formal prediction. NAR reasons include
NON_MEETING, MEETING_UNAVAILABLE, ALREADY_SAVED, NOT_SELECTED_LIMIT, DEADLINE,
CARD_IDENTITY, POST_TIME_UNKNOWN/REACHED, FIELD_INVALID, RACE_CONTEXT_INVALID,
ABILITY_INSUFFICIENT and SOURCE_OR_SAVE_FAILED. Events are returned to the Cron
result and logged with the CHASS NAR PRECOMPUTE prefix; no durable per-attempt reason table is introduced in this phase.

Viewer intercepts NAR /races, /day, /day-ai and /race when enabled. It verifies
version, identity, snapshot hash and pre-off source timestamp, returning an
ability-only payload with marketEvaluation disabled. No matching valid rows
falls back to existing app-saved NAR reads. HEAD/method policy remains owned by
the existing public handler; new responses retain public CORS/no-store. Latest
and recent endpoints still use legacy app-saved records; widening them is not
part of this patch. Rows are bounded to 500 per date query.

## Evidence and next checks

Seventeen new tests cover OFF/config/schema safety, NAR cap separation, immutable
rerun/concurrency, progress past held candidates, discovery/context/post/ability
HOLD, budget guards, Viewer day URL contract, route shapes, fallback, invalid
rows/hash tampering, Worker wiring and official full-width header handling.
Tests use an in-memory D1-compatible double, not production D1.

Read-only official verification on 2026-10-13: Kawasaki 1R header matches;
12 runners, 12 ability scores and 11 TIME values parsed from official
DebaTableSmall. Post time 15:00 JST. This is a source parsing check, NOT a
production Cron/D1/Viewer end-to-end success report. No production writes,
flag activation or direct deploy were performed.

After merge/build: verify schema, enable one venue in an approved canary,
measure processed/saved/HOLD reasons, then confirm actual Viewer rendering.
Only after this can throughput expand and probability/market/Signal work begin.

Full repository check: 1,780/1,780 PASS. Enabled precomputed day reads take
priority over legacy app-saved races for that venue/date; incomplete new days
are not merged with legacy predictions. Enable only an approved canary and
confirm complete coverage before wider rollout. Stored legacy data is unchanged.
