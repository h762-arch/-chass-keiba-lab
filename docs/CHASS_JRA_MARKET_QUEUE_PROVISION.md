# Phase109: cache diagnosis and audit-table provisioning

Phase108's production observation at 12:56 JST on 2026-10-10 showed:
MARKET 4/24, audit schema MISSING, POST_TIME_REACHED 10, ALREADY_FROZEN 4,
ODDS_UNAVAILABLE 10. These are observation-time results, not reconstructed
historical attempt causes. No missing/expired cache split was recorded then.

This patch adds a captured-cache diagnostic for every discovered race, including
already frozen and post-time races. The unchanged bridge reason and a separate
oddsReasonCounts report distinguish CACHE_ROW_MISSING, CACHE_IDENTITY_DUPLICATE,
CACHE_EXPIRY_INVALID, CACHE_EXPIRED, CACHE_FETCH_TIME_INVALID,
CACHE_FETCH_TIME_FUTURE and CACHE_TTL_FRESH_UNVALIDATED. fetchedAt, expiresAt,
observation time, ageMs and remainingTtlMs are retained without exposing payloads.
Fresh TTL does not imply complete or validated odds. Separate SELECT observations
cannot prove past cache availability or the original reason for missed Freeze.
The existing Preflight includes these fields automatically after merge.

## Audit table preparation

The Bridge and deploy do not provision D1. The runtime queue remains OFF.
This phase includes a separate CLI whose default mode reads schema only:

```sh
node scripts/jra-market-queue-provision.mjs
```

Use the repository root on merged main with the existing Cloudflare credentials.
No credentials are included in outputs. PLAN_ONLY indicates the table is absent.
ALREADY_PROVISIONED indicates its reviewed shape matches; UNKNOWN/drift blocks
application. The script pins the database binding name/UUID and the exact SHA-256
of the previously reviewed migration 0013:

`32b4f110f50914a787b94b9f4f38af05681ca90af4a047443fb015f171ead9c6`

The explicit application command is:

```sh
node scripts/jra-market-queue-provision.mjs --apply-0013
```

Only migrations/0013_jra_market_queue_audit.sql is applied, then columns, PK,
CHECK and indexes are read back. This is an isolated DDL execution, not a sweep
of all migrations. It does not insert a d1_migrations history row. MARKET,
SOURCE, DATA, cache contents and runtime flags are not modified. Repository
Queue configuration is checked; dashboard overrides are not verified here.

PROVISIONED requires schema readback MATCH. APPLY_OUTCOME_UNKNOWN and
APPLIED_UNVERIFIED do not imply success or failure: do not automatically rerun
application. Run the read-only command to inspect the state first. An existing
mismatched schema is blocked rather than repaired. Concurrent external changes
remain outside this one-run evidence.

If a terminal is unavailable, the reviewed 0013 SQL can be pasted into the
Cloudflare D1 SQL console for chass-keiba-research-db after confirming that the
schema is absent. Do not paste the Base64 patch into that console. This manual
route does not use the CLI guards; run READ-ONLY Preflight afterward and require
schema MATCH before a queue trial. Do not use a general migrations apply command.

After schema preparation, run CHASS JRA Production READ-ONLY Preflight v1 on
main with the current JST target_date. Check MARKET_EVIDENCE_JSON.queueReadiness
schema and per-race oddsDiagnostic/oddsReasonCounts. Actual Worker D1 read/save/
audit-write costs still need a bounded trial; this patch chooses no production
budget and enables no queue. Production Activation remains NO-GO. Formal EARLY
Reader, DATA limits and diamonds/warnings rules are unchanged.

Sources:
https://github.com/h762-arch/-chass-keiba-lab/actions/runs/38022004462
https://developers.cloudflare.com/d1/wrangler-commands/
