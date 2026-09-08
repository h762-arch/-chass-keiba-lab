# D1 ROWS_READ Emergency Optimization — Phase A

## Status

Phase A was performed at 06:38 JST, before the stated 09:00 JST quota reset. No remote D1 command, production endpoint request, remote migration, deployment, or retry was executed. All checks used source inspection and local mock D1/KV implementations.

## Confirmed code paths

| Endpoint/job | Entry function | D1 read path | Tables |
| --- | --- | --- | --- |
| `public/race?format=compact` | `handlePublicApi` | `publicAbilityMappedRaces` | `races` |
| `public/day-ai?format=compact` | `handlePublicApi` | `publicAbilityMappedRaces` | `races` |
| `public/ai-snapshot/...json` | `handlePublicApi` | KV hit, otherwise `publicAbilityMappedRaces` | KV; `races` only on miss |
| Other public race/day routes | `handlePublicApi` | `publicMappedRaces` | `races` |
| `/api/db/manifest` | `readD1Manifest` | up to 5,000 race rows; legacy fallback may read snapshot columns | `races` |
| `/api/db/research` | `readD1ResearchDataset` | three broad aggregate reads | `races`, `predictions`, `results` |
| `/api/db/similarity` | `readD1ResearchDataset` | same research dataset before in-memory selection | `races`, `predictions`, `results` |
| Scheduled result queue | `runScheduledResultQueue` | status-filtered query every five minutes | `races` |
| Historical collector | `runBackgroundHistoricalCollector` | job/calendar/race existence reads | `historical_collector_jobs`, `meeting_calendar`, `races` |
| Research sync | `runResearchSyncQueue` | queue acquisition plus per-target archive/index reads | research sync tables and `races` |

## Confirmed changes

1. Public date/track reads no longer use `race_id LIKE ?`.
   They use the existing `(race_id, model_version)` primary-key prefix as a bounded range:
   `race_id >= ? AND race_id < ?`.
2. Added the safe migration `migrations/0005_d1_rows_read_optimization.sql`:
   `idx_races_status_updated_at(status, updated_at)`.
   This targets the five-minute result-queue query. It has not been remotely applied.
3. Added optional KV cache binding support named `AI_SNAPSHOT_CACHE` for the fixed external AI snapshot.
4. Snapshot KV hit is evaluated before acquiring/reading D1. A hit returns the stored ability payload with `X-CHASS-Cache: HIT` and performs zero D1 queries.
5. Snapshot miss performs the existing single day read, writes the resulting payload to KV for 120 seconds, and returns `X-CHASS-Cache: MISS`. Without the binding, it safely reports `BYPASS` and preserves current behavior.
6. No prediction, probability, TIME, mark, suitability, or market-evaluation code was changed.

## High-read candidates found in source

The following are confirmed broad-read code paths, but their contribution to the five-million-row usage is not yet known:

- `readD1ResearchDataset`: reads up to 5,000 race rows and all grouped prediction/result rows.
- `/api/db/similarity`: builds the full research dataset before selecting one race.
- `readD1Manifest`: reads up to 5,000 rows and can run a second legacy fallback query.
- Scheduled result queue: runs every five minutes and previously lacked an index beginning with `status`.
- Public day/race reads previously used prefix `LIKE`; actual query-plan behavior on production D1 is unverified.

No day/snapshot horse-level N+1 query was found. The ability day path uses one D1 query and serializes in memory. The sync and background write workflows contain bounded sequential per-item operations, but are not used by the public snapshot read path.

## Index decision

Only one new index is proposed. No additional index is added for the public path because the range rewrite is designed to use the existing primary key whose leading column is `race_id`. Production `EXPLAIN QUERY PLAN` is required after reset to verify this assumption.

## Local verification

- JavaScript syntax check: passed
- Public API focused tests: 34 passed
- Full regression: 321 passed, 0 failed
- KV miss test: one mock D1 query and one KV write
- KV hit test: zero D1 queries, including with a D1 mock that throws if touched
- Snapshot schema/value equality: passed
- Existing ability-only and market-external behavior: preserved
- Remote D1 rows read/written: not measured before reset

## Cloudflare action required after reset

1. Create a Workers KV namespace.
2. Bind it to the Worker as `AI_SNAPSHOT_CACHE`.
3. Confirm D1 usage has reset before any remote query.
4. Run `EXPLAIN QUERY PLAN` only for the public range query and scheduled status query.
5. Apply migration `0005_d1_rows_read_optimization.sql` only after reviewing the plan.
6. Test one race, one day snapshot miss, and one immediate day snapshot hit; stop if rows read are unexpectedly large.

## Phase B pending

- Actual root cause and heaviest endpoint: unconfirmed
- Before/after `rows_read`: unconfirmed
- Production index plan/effect: unconfirmed
- 2026-09-09 Kawasaki 12 races / 151 horses: unconfirmed in this workspace
- Production snapshot MISS/HIT metrics: unconfirmed
- Reduction percentage: unconfirmed
