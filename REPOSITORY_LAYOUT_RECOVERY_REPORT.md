# CHASS KEIBA LAB Ver.10.0.1 Repository Layout Recovery Report

## Root cause

GitHub commit `51e4d31c8f708b99c748596fcc643b338d364f04` was uploaded with directory paths stripped. MCP files, tests, migrations and fixtures were flattened into the repository root. The MCP `package.json`, lockfile, `server.mjs` and README overwrote the root application files.

## Recovery source

- Root `package.json`, `package-lock.json`, `server.mjs`, `README.md`: immediate pre-overwrite commit `dd5c69035`.
- MCP files: current uploaded files from commit `51e4d31c8`, moved into `mcp/`.
- Migrations and tests: current uploaded files, moved into their formal directories.
- Fixtures: `result.html`, `race-card.html`, `odds.html`, `runs.txt`, placed under `tests/fixtures/` according to `worker-parser.test.mjs`.

## Integrity

- `migrations/0006_jra_background_refresh.sql` SHA-256: `a6287099178296d31c745cb49a25b9736d807c3665bf7364a665e0842ab6ad77`.
- 0006 changed: no. Move-only; hash is identical before and after recovery.
- 0006 is additive, contains `CREATE TABLE IF NOT EXISTS jra_meeting_calendar`, and contains no `DROP`, `DELETE`, `UPDATE`, or `ALTER`.
- Protected application/JRA files listed in `IMPORTANT_SHA256_BEFORE_RECOVERY.txt` are byte-identical after layout recovery.
- Google Drive Runtime forbidden identifiers and endpoints were not found in `app.js`, `worker.js`, `server.mjs`, `research-storage-sync.mjs`, or `wrangler.jsonc`.
- Production D1 was not modified.

## Moved files

- Root to `migrations/`: `0001_research_cloud.sql` through `0006_jra_background_refresh.sql`.
- Root to `tests/`: all `*.test.mjs` except root `regression.test.mjs`.
- Root to `tests/fixtures/`: `result.html`, `race-card.html`, `odds.html`, `runs.txt`.
- Root to `mcp/`: `bridge-client.mjs`, `chass-tools.mjs`, and the overwritten MCP copies of `server.mjs`, `package.json`, `package-lock.json`, `README.md`.

## Identity guards

- Root package: `chass-keiba-lab` / `10.0.1`.
- MCP package: `chass-keiba-lab-mcp` / `9.9.35`.
- Root server is the CHASS local application server and does not import MCP SDK server transports.
- `mcp/server.mjs` is the read-only Streamable HTTP MCP server.
- Root and MCP README titles are separated.
- Layout tests reject future flattened duplicates and Root/MCP identity swaps.

## Verification results

- Repository Layout and Identity: 5/5 PASS.
- JRA J1-J5: 61/61 PASS (18 + 12 + 11 + 12 + 8).
- False Exclusion, NAR parser/result recovery, Public API, AI Data Bridge, Google Drive decommission: included in Full Check, PASS.
- MCP standalone check: 15/15 PASS.
- Root Full Check: 392/392 PASS, FAIL 0, SKIP 0, ONLY 0.
- Difference from the previous 390 count: two new active regression tests were added—Root/MCP identity separation and flattened-duplicate rejection.
- Migration dry run: 0001 through 0006 applied successfully, in order, to a temporary SQLite database.

## Remote D1 commands (not executed)

```sh
npx wrangler d1 migrations list chass-keiba-research-db --remote
npx wrangler d1 migrations apply chass-keiba-research-db --remote
```

Confirm the exact production DB target before any remote apply.

## GitHub status

The recovery commit was prepared locally, but the HTTPS push was rejected because no GitHub credentials are available in this environment. The remote repository therefore remains at the flattened tree until an authenticated user pushes the prepared commit or uploads the verified recovery ZIP with paths preserved.
