# CHASS JRA Precompute Foundation — Phase 1 v7 Report

## Decision

GO for independent code review and local/staging-only evaluation.

NO-GO for production deploy, production D1 migration, feature-flag activation,
Viewer activation, model promotion, PR merge, or direct main changes.

## Baseline and scope

- Baseline: `5a44b8c01f25217b84667eda2a3af3730c730dd1`
- Branch: `chass/jra-precompute-phase1`
- Completed: 2026-09-17 JST
- Runtime flags remain OFF:
  - `ENABLE_BACKGROUND_PRECOMPUTE=false`
  - `ENABLE_PRECOMPUTED_VIEWER=false`
- Existing Worker and App are not connected to the new precompute functions.
- Production D1 was not read, written, migrated, or queried.

## Implemented foundation

### Independent-audit corrections in v2

- Moved the identical-input lookup ahead of `calculate()` so an unchanged source/model/version performs zero calculation and zero save work.
- Added a version-consistency guard between the declared job versions and calculator output.
- Expanded recursive DATA validation to reject Japanese market keys and common aliases such as expected return, betting price, implied probability, and public/betting rank.
- Added two focused regression tests for version-separated hashes and pre-calculation idempotency/version mismatch.
- Rebuilt the FULL comparison archive from the exact Baseline so no pre-existing repository file is omitted.

### Second independent-audit corrections in v3

- Added `clusterVersion` and `signalRuleVersion` to calculation `inputHash` identity.
- Canonicalized SOURCE hashing so acquisition timestamps/fetch metadata do not trigger recalculation; `sourceAcquiredAt` remains independently stored.
- Added `snapshotHash` to separate revision-content idempotency from calculation-input idempotency.
- Changed D1 indexes so the same `inputHash` can append changed MARKET/RESULT revisions while identical `snapshotHash` content remains a no-op.
- Froze SOURCE, DATA, MARKET, and FINAL after FINAL exists; RESULT remains append-only.
- Recomputed semantic source/input hashes when SOURCE is revised before FINAL.

### Third independent-audit corrections in v4

- SOURCE revisions before FINAL clear DATA, MARKET, FINAL, and RESULT so stale downstream calculations cannot survive a source change.
- DATA revisions before FINAL clear MARKET, FINAL, and RESULT so old odds/EV cannot remain attached to changed probabilities.
- MARKET revisions remain pre-FINAL only and clear FINAL/RESULT.
- RESULT is rejected unless FINAL already exists, both at snapshot creation and revision append.
- The normal SOURCE→DATA→MARKET→FINAL→RESULT order is tested end to end with FINAL byte-equivalence after RESULT.
- Runner ownership is explicit: calculation owns SOURCE/DATA, a separate market runner owns odds/popularity/EV before FINAL, and a separate result runner appends official RESULT after FINAL.

### Fourth independent-audit corrections in v5

- MARKET is now a hard prerequisite for FINAL at both creation and revision append.
- The calculation runner rejects calculator output containing MARKET, FINAL, or RESULT and persists SOURCE/DATA as PARTIAL only.
- Dedicated market, finalization, and result revision functions enforce layer ownership and lifecycle order.
- FINAL ownership is explicitly assigned to the finalization runner.
- DATA revisions set `calculatedAt` to their revision time; viewer freshness now reflects the latest DATA calculation rather than the original snapshot time.

### Fifth independent-audit corrections in v6

- Split freshness into `dataCalculatedAt` (actual DATA calculation) and `sourceValidatedAt` (latest successful semantic SOURCE confirmation).
- Viewer freshness now uses `sourceValidatedAt`, with calculation timestamps only as compatibility fallback.
- Matching inputHash with valid DATA performs zero recalculation but persists a SOURCE-validation revision, allowing STALE snapshots to self-recover.
- Matching inputHash without DATA does not short-circuit and is recalculated.
- Metadata-only SOURCE changes preserve DATA, MARKET, FINAL, and RESULT; only semantic SOURCE changes invalidate downstream.
- snapshotHash includes freshness metadata so updated validation time is durably appendable in D1.

### Sixth independent-audit corrections in v7

- Made `sourceValidatedAt` monotonic: a delayed validation older than the latest successful validation is a no-op and cannot regress viewer freshness.
- Replaced the calculation runner's historical matching-input loader contract with an explicit latest-race-revision loader contract.
- The runner short-circuits only when the latest race revision itself has the current `inputHash` and a DATA layer.
- An A→B→A semantic SOURCE cycle recalculates SOURCE/DATA as a new PARTIAL snapshot and never restores historical MARKET/FINAL/RESULT layers.
- Propagated D1 save outcomes so a duplicate/concurrent `saved:false, reason:UNCHANGED` result is never reported as `SAVED`.

### Snapshot lifecycle

The foundation represents five isolated layers:

1. `SOURCE`: official source material and acquisition metadata.
2. `DATA`: ability, suitability, pace, TIME, and prediction values without market input.
3. `MARKET`: odds, popularity, and expected value inputs.
4. `FINAL`: deeply immutable pre-race prediction output.
5. `RESULT`: post-race facts appended without rewriting FINAL.

Status vocabulary is now:

- `CALCULATED`
- `NOT_CALCULATED`
- `STALE`
- `PARTIAL`

### Safety properties

- Recursive DATA validation rejects odds, popularity, EV, expected-value, and market fields.
- FINAL and nested children are deeply frozen.
- RESULT append records hashes and verifies the FINAL hash is unchanged.
- SHA-256 input hashing uses standards-based Web Crypto rather than `node:crypto`.
- Default and explicit version values produce the same `inputHash`.
- JRA and NAR identity keys remain separate.
- Disabled background precompute performs zero source, calculation, lookup, or save I/O.

### D1 adapter

`src/prediction/precomputed-store.mjs` adds an unconnected D1 adapter for local and
future staging use:

- five-layer row serialization;
- organization-scoped inputHash lookup;
- identical-calculation-input lookup before calculation;
- identical-snapshot no-op behavior;
- append-only revision allocation;
- latest snapshot reconstruction with deep immutability.

This adapter is not imported by `worker.js`, `worker-entry.mjs`, or `app.js` in Phase 1.

## Cloudflare Worker compatibility

- Removed `node:crypto` and `createHash` from precompute runtime source.
- Hashing uses `globalThis.crypto.subtle.digest('SHA-256', ...)`.
- Node syntax checks passed for all Phase 1 modules.
- Wrangler 4.132.0 dry-run bundle passed with compatibility date 2026-08-27.
- Dry-run only; no upload or deploy occurred.

## Migration audit

Local temporary SQLite applied migrations 0001 through 0012 in order: PASS.

Changed migration:

- `0012_precomputed_snapshots.sql`, before any production application:
  - status vocabulary correction `READY` → `CALCULATED`;
  - required `snapshot_hash` column;
  - required `source_validated_at` and optional `data_calculated_at` freshness columns;
  - nullable legacy `calculated_at` for SOURCE-invalidated PARTIAL revisions;
  - non-unique `input_hash` lookup index;
  - unique `snapshot_hash` revision-idempotency index.

Unchanged migrations:

- 0001 through 0011, including 0006 and 0011.

Integrity hashes:

- 0006: `a6287099178296d31c745cb49a25b9736d807c3665bf7364a665e0842ab6ad77`
- 0011: `fc2cf81652c6475ee9341471145b26249eb83792ba2768dd2604ebd9a0241a46`
- 0012 Phase 1 v6: `c90ebe337f9b5ebc8af49b1f79e846fc9c605add082bf09ef20e21fcf99950d9`

## Regression results

| Check | Result |
|---|---:|
| `npm ci` | PASS |
| `npm ci --prefix mcp` | PASS |
| `npm run check` | 626/626 PASS |
| Fail / skipped / cancelled / only | 0 / 0 / 0 / 0 |
| Phase 1 focused tests | 43/43 PASS |
| JRA J1 | 18/18 PASS |
| JRA J2 | 13/13 PASS |
| JRA J3 | 11/11 PASS |
| JRA J4 | 12/12 PASS |
| JRA J5 | 8/8 PASS |
| JRA J1-J5 total | 62/62 PASS |
| NAR focused suite | 49/49 PASS |
| Public API | 34/34 PASS |
| AI Data Bridge | 16/16 PASS |
| Drive decommission guards | 10/10 PASS |
| Migration 0001→0012 dry-run | PASS |
| Wrangler dry-run bundle | PASS |

Baseline was 589 tests. Phase 1 v7 adds thirty-seven net tests, producing 626 active tests.

## Google Drive decommission verification

Production runtime source remains free of Google OAuth, Sheets API, Drive read routes,
Drive service-account configuration, and Drive fallback handlers. Historical reports,
offline scripts, and tests were excluded from the runtime scan as intended.

## Production D1 migration prerequisites

Before considering production migration or flag activation, all of the following are required:

1. Independent review of this Phase 1 diff and the 0012 status correction.
2. Confirm production migration history and exact D1 database identity.
3. Apply 0011 and 0012 to a disposable/local database and then a non-production environment.
4. Verify Worker D1 reads/writes with real D1 response metadata and concurrent revision attempts.
5. Keep both feature flags OFF immediately after any schema deployment.
6. Run a shadow JRA subset and byte-compare official AI win, place, TOTAL, TIME, marks, EV, 💎, and ⚠️ against the existing path.
7. Verify no market field enters DATA and no RESULT operation changes FINAL.
8. Establish completeness, stale-rate, latency, retry, and failure observability.
9. Obtain explicit human approval before enabling background precompute.
10. Keep Viewer OFF until precompute coverage and freshness pass a separate acceptance review.

## Production-operation attestation

- GitHub push: not performed.
- PR creation or merge: not performed.
- Cloudflare deploy: not performed.
- Production D1 migration or execute: not performed.
- Feature flag activation: not performed.
- Model promotion: not performed.
- Production secrets: not read or changed.
