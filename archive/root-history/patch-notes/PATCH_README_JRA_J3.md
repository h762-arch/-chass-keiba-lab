# CHASS KEIBA LAB Ver.10.0.1 — JRA J1+J2+J3 patch

This is a self-contained changed-files patch against source commit `000726ce27188ef92ab638617e04c7c8cd3c7817`. Upload every file to the repository root while preserving its relative path.

## Implemented scope

### J1 — Meeting-aware selector
- JRA meeting discovery and date / track / race selector
- `GET /api/jra/meeting`
- meeting, non_meeting, unknown and loading states remain distinct
- cache, single-flight, circuit breaker, stale-response guard and manual fallback

### J2 — Official race card
- `GET /api/jra/race`
- official race core, runner core and published past-run parsing
- parser quality gate and current/historical cancellation isolation
- the existing JRA normalizer, adapter and model are reused
- JSON / CSV / manual input remains available

### J3 — Official win odds
- `GET /api/jra/odds?date=YYYY-MM-DD&track=中山&race=5`
- horse-number keyed JRA win odds and popularity
- live / final label separation when the official page identifies final odds
- odds_unavailable, fetch error and parser error remain separate
- 30-second minimum refresh cache and request single-flight
- stale responses cannot update another selected race
- current scratched runners are excluded from odds coverage
- market data is stored separately from the frozen Prediction Snapshot
- D1 updates `market_json`, `final_json` and market columns only when their fingerprints change

## Production defaults

`wrangler.jsonc` contains:

- `ENABLE_JRA_MEETING_DISCOVERY=true`
- `ENABLE_JRA_AUTO_FETCH=false`
- `ENABLE_JRA_ODDS_FETCH=true`
- `ENABLE_JRA_RESULT_FETCH=false`

JRA odds are fetched only when the user presses **JRA公式から現在オッズを取得**. There is no JRA 60-second auto-refresh in J3. JRA result automation remains outside this patch.

## Market isolation

JRA official odds are never passed into `jra-model.js`. The order is:

1. Official race data
2. Existing JRA ability/model calculation
3. Frozen Prediction Snapshot
4. JRA official win odds
5. Separate Market Snapshot and EV/value display

Tests verify that applying odds does not change AI win probability, AI TOP3 probability, overall ability, predicted time, or the frozen Prediction Snapshot.

## Files

- `app.js`
- `index.html`
- `styles.css`
- `worker.js`
- `server.mjs`
- `package.json`
- `wrangler.jsonc`
- `jra-meeting-discovery.mjs`
- `jra-meeting-selector.js`
- `jra-program-fixture.html`
- `jra-j1.test.mjs`
- `jra-race-fetch.mjs`
- `jra-race-client.js`
- `jra-race-card-fixture.html`
- `jra-j2.test.mjs`
- `jra-odds-fetch.mjs`
- `jra-odds-client.js`
- `jra-j3.test.mjs`
- `PATCH_README_JRA_J3.md`
- `JRA_J3_SHA256.json`

## Verification

- J1–J3 focused tests: **41 passed, 0 failed**
- Full reconstructed suite: **363 total, 358 passed, 5 failed**
- Baseline before JRA work: **322 total, 317 passed, 5 failed**
- New regression failures: **0**

The same five baseline failures remain because the uploaded source lacks files already referenced by its tests/scripts:

- `google-drive-production.mjs`
- `mcp/server.mjs` (three affected checks/tests)
- `.gitignore`

`npm run check` reaches the existing missing `mcp/server.mjs` reference and stops. All added JRA syntax checks and focused tests pass independently.

## Upload and check

1. Upload all 20 files with their exact relative paths.
2. Deploy the Cloudflare Worker normally.
3. Select **中央競馬**, a valid date, an active track, and a race.
4. Press **JRA公式データを取得・予想開始**.
5. After the prediction appears, open **現在オッズ**.
6. Press **JRA公式から現在オッズを取得**.
7. Confirm the horse count, odds, popularity and EV display against the official page.
8. Confirm AI ability ranking and predicted time remain unchanged.
9. Keep JRA 60-second odds refresh off and JRA result automation off.

## Official validation pages

- Race-card list: <https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dli00/F3>
- Race-card sample containing win odds: <https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dde0106202604010520260905%2F16>
- 2026 schedule sample: <https://www.jra.go.jp/keiba/calendar2026/2026/9/0912.html>

The fixture is a reduced excerpt used for deterministic tests. Live end-to-end fetching must be confirmed after Worker deployment because this execution environment cannot reliably complete the official listing request.
