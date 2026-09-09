# CHASS KEIBA LAB Ver.10.0.1 — JRA J1–J4 Patch

This ZIP is a self-contained changed-files patch for manual upload to the repository root. It includes all J1–J4 files; the earlier J1/J2/J3 ZIPs are not required.

## Included phases

- J1: JRA meeting discovery and meeting-aware selector
- J2: JRA official race-card fetch, quality gate, existing normalizer/adapter/model connection
- J3: manual JRA official win-odds fetch with market/ability separation
- J4: post-race JRA official result fetch, immutable snapshot guard, existing JRA validation/calibration, and low-frequency result queue

## J4 behavior

- New read-only endpoint: `GET /api/jra/result?date=YYYY-MM-DD&track=中山&race=3`
- The Worker requests JRA official public pages only.
- It resolves an exact result link from the selected official race card; arbitrary destinations and redirects are rejected.
- Result fetch is blocked server-side until five minutes after the official post time.
- `result_unpublished`, network/HTTP failure, and parser failure remain separate states.
- A result requires at least the top three and unique horse numbers. Missing values remain `null`.
- Result data is stored separately from the frozen Prediction and Market snapshots.
- Saved JRA predictions enter the existing low-frequency result queue; the queue reuses existing JRA calibration/validation.
- Manual JSON/CSV/manual-input fallbacks remain available.

## Manual upload

Upload the ZIP contents to the repository root while preserving every path, then commit to `main`. Existing same-name files should be replaced by the files in this ZIP; new files should be added.

After upload, deploy the Worker normally. No new secret is required.

Feature flags in `wrangler.jsonc`:

- `ENABLE_JRA_MEETING_DISCOVERY=true`
- `ENABLE_JRA_AUTO_FETCH=false`
- `ENABLE_JRA_ODDS_FETCH=true`
- `ENABLE_JRA_RESULT_FETCH=true`

JRA race-card auto-fetch intentionally remains OFF. Meeting discovery, explicit race-card fetch, explicit odds fetch, explicit result fetch, and the existing low-frequency post-race queue are available.

## Verification performed

- J1: 18/18 passed
- J2: 12/12 passed
- J3: 11/11 passed
- J4: 12/12 passed
- Full suite: 375 total, 370 passed, 5 failed
- New failures caused by J1–J4: 0

The five full-suite failures are pre-existing source-package omissions/incompatibilities: missing `mcp/server.mjs`, missing MCP SDK installation, missing `.gitignore`, and the existing Google Drive production export mismatch. `npm run check` stops at the missing `mcp/server.mjs` after all preceding syntax checks succeed.

## Official source used for J4 fixture and parser contract

- JRA official result page: https://www.jra.go.jp/JRADB/accessS.html?CNAME=pw01sde0106202604020320260906%2F98
- JRA official race-card page: https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dde0106202604010520260905%2F16

The bundled HTML is a reduced semantic test fixture, not a substitute for a deployed live check. If JRA changes the official page structure, the parser fails safely and the existing manual fallback remains available.
