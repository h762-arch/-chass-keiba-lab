# CHASS KEIBA LAB Ver.10.0.1 — JRA J1+J2 patch

This ZIP is a self-contained changed-files patch against the uploaded latest GitHub source (`000726ce27188ef92ab638617e04c7c8cd3c7817`). It includes J1 meeting discovery and J2 official race-card fetching. Preserve each relative path when uploading to the repository root.

## Scope

### J1 retained
- JRA meeting-aware date / track / race selector
- `GET /api/jra/meeting`
- meeting / non_meeting / unknown / loading separation
- cache, single-flight, circuit breaker and stale-response guard
- manual selection fallback

### J2 added
- `GET /api/jra/race?date=YYYY-MM-DD&track=中山&race=5`
- Worker-side access to the public JRA race-card listing, followed by its exact official race-card link
- semantic HTML parsing for race core, runner core and published past runs
- current-race cancellation separated from historical cancellation/exclusion
- parser quality gate, identity checks, duplicate runner guard, size/timeout limits and safe error classification
- existing `jra-normalizer.js` -> `jra-adapter.js` -> `jra-model.js` path reused unchanged
- explicit **JRA公式データを取得・予想開始** button
- existing JSON / CSV / manual input retained as fallback

## Safety defaults

- `ENABLE_JRA_AUTO_FETCH` defaults to `false`; the explicit fetch button still works.
- J2 does not fetch or inject odds. `odds` and `popularity` remain `null`, so ability calculation is market-independent.
- No result automation is included in J2.
- A malformed, incomplete or mismatched page stops prediction rather than guessing values.
- Browser code does not contact JRA directly. The Worker/server performs the official fetch.
- Only `www.jra.go.jp` links resolved from the official race-card listing are accepted.
- Redirect following is disabled, fetch timeout is 10 seconds and response size is capped at 2 MiB.

## Files in this patch

- `app.js`
- `index.html`
- `styles.css`
- `worker.js`
- `server.mjs`
- `package.json`
- `jra-meeting-discovery.mjs`
- `jra-meeting-selector.js`
- `jra-program-fixture.html`
- `jra-j1.test.mjs`
- `jra-race-fetch.mjs`
- `jra-race-client.js`
- `jra-race-card-fixture.html`
- `jra-j2.test.mjs`
- `PATCH_README_JRA_J2.md`
- `JRA_J2_SHA256.json`

## Feature flags

Configure Worker vars as needed:

- `ENABLE_JRA_MEETING_DISCOVERY` — defaults to enabled
- `ENABLE_JRA_AUTO_FETCH` — defaults to disabled; controls automatic selection-triggered fetching, not the explicit button
- `ENABLE_JRA_ODDS_FETCH` — remains disabled / unused in J2
- `ENABLE_JRA_RESULT_FETCH` — remains disabled / unused in J2

The browser-side automatic selection fetch also requires:

```html
<script>
window.CHASS_FEATURES = { ENABLE_JRA_AUTO_FETCH: true };
</script>
```

Do not enable that browser setting until the Worker flag is also enabled and representative live meetings have been checked.

## Verification performed

- J1+J2 focused tests: **30 passed, 0 failed**
- Full reconstructed suite: **352 total, 347 passed, 5 failed**
- Baseline before JRA work: **322 total, 317 passed, 5 failed**
- New regression failures: **0**

The same five baseline failures remain because the uploaded source lacks files already referenced by its tests/scripts:

- `google-drive-production.mjs`
- `mcp/server.mjs` (affects three tests/checks)
- `.gitignore`

`npm run check` reaches the pre-existing missing `mcp/server.mjs` reference and stops there. All new JRA module syntax checks and the focused J1/J2 tests pass independently.

## Manual verification after upload

1. Upload every file with the exact relative path.
2. Deploy the Worker using the repository's normal process.
3. Open CHASS and select **中央競馬**.
4. Choose a valid JRA date, active track and race.
5. Press **JRA公式データを取得・予想開始**.
6. Confirm the displayed date, track, race number and runner count against the JRA page.
7. Confirm JSON / CSV and manual input still work from the fallback panel.
8. Keep JRA odds/result automation off; those belong to J3/J4.

## Official pages used for parser validation

- Race card list: <https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dli00/F3>
- Race-card sample: <https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dde0106202604010520260905%2F16>
- 2026 schedule sample: <https://www.jra.go.jp/keiba/calendar2026/2026/9/0912.html>

The bundled HTML fixture is a reduced semantic excerpt for deterministic parser tests. Live JRA end-to-end fetching must be checked after deployment because this execution environment cannot reliably complete the official listing request.
