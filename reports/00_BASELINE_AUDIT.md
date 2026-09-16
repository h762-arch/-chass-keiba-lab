# 00 Baseline Audit

- Audited main: `d9efc6e726f3c1849225de5eced91e25299b5cb4`
- Root identity: `chass-keiba-lab` `10.0.1`; MCP remains a separate subproject.
- Migrations before work: `0001` through `0010`.
- Baseline after root and MCP dependency install: 578/578 pass, fail 0, skip 0.
- JRA J1–J5 baseline/current: 18 + 13 + 11 + 12 + 8 = 62 pass.
- Protected `0006` SHA-256: `a6287099178296d31c745cb49a25b9736d807c3665bf7364a665e0842ab6ad77`.
- Existing live-odds polling policy remains frozen. Existing cron expressions and existing flags were not enabled or changed.
- Added flags `ENABLE_BACKGROUND_PRECOMPUTE=false` and `ENABLE_PRECOMPUTED_VIEWER=false` only.

Rollback point: audited main SHA above.
