# D1 ROWS_READ Optimization — Phase A patch

This package contains pre-reset code and migration preparation only. It does not indicate that production D1 recovery or rows-read reduction has been verified.

## Replace

- `worker.js`
- `d1-schema.sql`
- `tests/public-read-only-api.test.mjs`
- `tests/auto-result-queue.test.mjs`

## Add

- `migrations/0005_d1_rows_read_optimization.sql`
- `D1_ROWS_READ_PHASE_A_REPORT.md`

## Cloudflare setup after the quota reset is confirmed

1. Create one Workers KV namespace.
2. Add the Worker binding name `AI_SNAPSHOT_CACHE` to that namespace.
3. Review and apply `migrations/0005_d1_rows_read_optimization.sql`.
4. Test one race compact request.
5. Test one fixed snapshot request and record D1 rows read.
6. Repeat the same snapshot once and confirm `X-CHASS-Cache: HIT` with zero D1 queries/rows read.

Do not repeatedly request production endpoints if the first query reports unexpectedly high rows read.

## Local check

```sh
npm test
```

Expected: 321 passed, 0 failed.
