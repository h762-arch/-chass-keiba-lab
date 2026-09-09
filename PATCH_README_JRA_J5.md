# CHASS KEIBA LAB Ver.10.0.1 — JRA J1–J5 Patch

This is a self-contained changed-files patch for manual upload to the repository root. Earlier JRA patch ZIPs are not required.

## Included phases

- J1: official meeting discovery and meeting-aware selector
- J2: official race-card fetch, quality gate, existing JRA model connection
- J3: manual official win-odds fetch with ability/market separation
- J4: official result fetch and existing validation connection
- J5: safe background meeting refresh and JRA result retry

## J5 safety limits

- Cloudflare Cron remains one `*/5 * * * *` trigger.
- Result collection remains the first scheduled priority.
- JRA meeting refresh requests at most one date per Cron run.
- Only today and tomorrow in Asia/Tokyo are refresh candidates.
- Today is cached for 30 minutes; tomorrow for 6 hours.
- A failed meeting lookup is cached as `unknown` for 15 minutes and is never converted to `non_meeting`.
- JRA meeting data uses the separate `jra_meeting_calendar` D1 table. It cannot overwrite the NAR `meeting_calendar` table.
- Background Race Card and Odds collection are not implemented and are not requested.
- JRA results are requested only for due saved Prediction records in `result_waiting`, `result_pending`, or `result_retry` state.
- Prediction, Market, and FINAL snapshot JSON are reused unchanged when a result is saved.
- The existing retry schedule and six-attempt ceiling remain in effect.

## Manual upload

Upload all ZIP contents to the repository root while preserving paths, then commit to `main`.

The new D1 migration is:

`migrations/0006_jra_background_refresh.sql`

The Worker also creates the same table with `CREATE TABLE IF NOT EXISTS`, so this patch is additive and does not delete or rewrite existing research data.

Feature flags in `wrangler.jsonc`:

- `ENABLE_JRA_MEETING_DISCOVERY=true`
- `ENABLE_JRA_AUTO_FETCH=false`
- `ENABLE_JRA_ODDS_FETCH=true`
- `ENABLE_JRA_RESULT_FETCH=true`
- `ENABLE_JRA_BACKGROUND_REFRESH=true`

Deploy the Worker normally after committing. No new secret is required.

## Verification performed

- J1: 18/18 passed
- J2: 12/12 passed
- J3: 11/11 passed
- J4: 12/12 passed
- J5: 8/8 passed
- JRA J1–J5 total: 61/61 passed
- Full suite: 383 total, 378 passed, 5 failed
- New J1–J5 regression failures: 0

The five full-suite failures are the same pre-existing source-package issues: missing `mcp/server.mjs`, missing MCP SDK installation, missing `.gitignore`, and the existing Google Drive production export mismatch. `npm run check` stops when it reaches the missing `mcp/server.mjs` after the preceding syntax checks.

## Official references

- JRA program/calendar: https://www.jra.go.jp/keiba/calendar2026/2026/9/0912.html
- JRA result example: https://www.jra.go.jp/JRADB/accessS.html?CNAME=pw01sde0106202604020320260906%2F98
- Cloudflare scheduled handler: https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/
- Cloudflare D1 prepared statements: https://developers.cloudflare.com/d1/worker-api/prepared-statements/

Live JRA and deployed Worker end-to-end behavior must still be confirmed after upload and deployment. If the official HTML structure changes, parsing fails safely and manual JSON/CSV/input fallback remains available.
