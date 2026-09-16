# 07 Full Regression

Baseline: 578/578 pass after installing root and MCP dependencies.

After changes:
- `npm run check`: 604/604 pass
- fail 0, skipped 0, cancelled 0
- historical audit correction tests: 12/12 pass
- J1: 18/18; J2: 13/13; J3: 11/11; J4: 12/12; J5: 8/8 (total 62/62)
- migration dry-run: `0001` through `0012` applied sequentially to temporary SQLite
- production D1 migration: not run
- `0006` unchanged at SHA-256 `a6287099178296d31c745cb49a25b9736d807c3665bf7364a665e0842ab6ad77`
