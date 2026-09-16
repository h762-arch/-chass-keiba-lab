# CHASS Google Drive Runtime Decommission Report

## Decision

GO for independent review and manual GitHub handoff. NO-GO for deploy, merge,
production D1 operations, or model promotion within this Work task.

## Baseline and scope

- Repository: `h762-arch/-chass-keiba-lab`
- Baseline: `f77949584fe6e4d83dde95033ba5c894d244eb46`
- Audit time: 2026-09-16 13:52 JST
- Theme: remove Google Drive, Google Sheets, OAuth, and Service Account access from
  the production Worker runtime without changing predictions, JRA/NAR logic, D1
  schemas, precompute, or model governance.

## Root cause

The decommission policy and the runtime implementation diverged. `worker.js` still
imported a Drive read bridge, exposed Drive health and bridge routes, and routed the
JRA race endpoint through a Drive fallback wrapper. Two active GitHub workflows could
also authenticate with a Google Service Account and call the Sheets API. Wrangler
still carried the spreadsheet identifier as a production runtime variable.

## Applied correction

- `worker.js` now imports the official JRA handler directly from
  `jra-race-fetch.mjs`.
- Drive health and AI Data Bridge routes were removed.
- Drive/Sheets/OAuth runtime modules and the JRA Drive fallback wrapper were deleted.
- The D1-retention workflow that depended on Sheets was deleted rather than allowed
  to run without its backup source.
- The JRA health workflow retains `app_all` and `official_d1` only. Its Drive fallback
  job, credentials, source allowance, and input were removed.
- The Wrangler spreadsheet runtime variable was removed.
- Positive Drive runtime tests were replaced with a fail-closed decommission guard.
- Legacy D1 columns/tables and `disabled_legacy` compatibility behavior remain intact.

## Changed files

Modified:

- `.github/workflows/CHASS-JRA-Health-Smoke-v1.0.yml`
- `worker.js`
- `wrangler.jsonc`

Added:

- `tests/google-drive-runtime-decommission.test.mjs`
- `reports/10_DRIVE_RUNTIME_DECOMMISSION.md`
- `CHANGED_FILES_DRIVE_DECOMMISSION.txt`

Deleted:

- `.github/workflows/CHASS-JRA-D1-Retention-v1.0.yml`
- `google-drive-readonly-api.mjs`
- `google-drive-readonly-import.mjs`
- `jra-drive-prediction-input.mjs`
- `tests/google-drive-cloudflare-api.test.mjs`
- `tests/google-drive-readonly-import.test.mjs`
- `tests/jra-drive-friday-fallback-v15.test.mjs`
- `tests/jra-drive-prediction-input.test.mjs`

## Runtime safety scan

Runtime scan scope: production JavaScript/MJS, Worker configuration, and active
workflow YAML. Tests, offline audit scripts, archive, docs, and reports are excluded
from the runtime scan. Historical text remains documentation only.

Zero runtime matches were found for:

- `oauth2.googleapis.com`
- `sheets.googleapis.com`
- `GOOGLE_DRIVE_READ_SERVICE_ACCOUNT_JSON`
- `ENABLE_DRIVE_READ_IMPORT`
- `CHASS_DRIVE_SPREADSHEET_ID`
- `/api/drive-read/health`
- `/api/chass/v1/drive`
- `handleDriveReadHealth`
- `handleDriveReadBridge`

The only remaining active-workflow references to “Google Drive” are assertions in
the existing decommission regression test; they cannot authenticate or call Google.

## Regression results

| Check | Result |
|---|---:|
| `npm ci` | PASS |
| `npm ci --prefix mcp` | PASS |
| `npm run check` | 589/589 PASS |
| Full fail / skipped / cancelled / only | 0 / 0 / 0 / 0 |
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
| Cross-area focused regression | 137/137 PASS |

The baseline reference count was 604. The new total is 589 because four positive
Drive-runtime/fallback test files were deleted and one five-test decommission guard
was added. No test was skipped, marked only, or removed merely to hide a failure.

## Migration integrity

- Local temporary SQLite dry-run: 0001 through 0012 applied in order, PASS.
- Migration diff from baseline: none.
- `migrations/0006_jra_background_refresh.sql` SHA-256:
  `a6287099178296d31c745cb49a25b9736d807c3665bf7364a665e0842ab6ad77`
- 0011 and 0012 unchanged.
- No migration was added.

## Runtime configuration integrity

- `ENABLE_BACKGROUND_PRECOMPUTE = "false"`
- `ENABLE_PRECOMPUTED_VIEWER = "false"`
- Existing JRA/NAR flags retain their baseline values.
- Cron remains `*/5 * * * *`, `0 11 * * *`, and `30 11 * * *`.
- D1 binding and database ID are unchanged.

## Operational attestation

- Production D1 was not queried, modified, or migrated.
- Cloudflare deploy was not run.
- No GitHub push, PR, merge, secret change, or model promotion was performed.
- Precompute source was not changed.
- JRA/NAR prediction source, `app.js`, and model logic were not changed.

## Sources

- https://github.com/h762-arch/-chass-keiba-lab
