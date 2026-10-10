# Phase108: read-only MARKET queue readiness

The existing Production READ-ONLY Preflight now adds an automatic Phase108
readiness report to MARKET_EVIDENCE_JSON and its job summary. No workflow,
runtime flag, DATA limit, EARLY reader or Signal rule changes are required.
Run that existing workflow from main with a JST target_date after this patch
has passed CI and been merged. Fresh current-day meeting evidence is required.

The report reuses the meeting and snapshot rows already read by MARKET audit,
then adds three SELECTs: table columns via pragma_table_info, table/index/trigger
metadata via sqlite_master, and target-date official odds cache rows. It performs
no production mutation, migration, MARKET save or audit-event insert.

Schema statuses are MATCH, MISSING, MISMATCH or UNKNOWN. The exact seven column
names/types/nullability, composite primary-key order, event-number check, named
indexes and absence of unreviewed triggers are inspected. MATCH is shape
compatibility; it is not a migration-history, permissions, write-performance or
operational activation approval. MISSING requires separately provisioning the
already-reviewed migration 0013; this script never applies it automatically.

Each captured race is checked through Phase107 eligibility and the actual
Phase105 bridge, with its save function replaced by a non-writing simulator.
WOULD_FREEZE means that captured data passed validation. It never means stored
Freeze. Existing stored MARKET integrity still comes from the separate snapshot
audit. The captured DB accepts only four exact SELECT templates and has no write
route. Unexpected SQL, duplicate cache identities or corrupt evidence fail.

Reported timing has two different contexts:

- Remote SELECT elapsed time includes CLI startup, network and D1 overhead;
  meeting/snapshot fetches reused from the earlier audit are not timed here.
- Captured-data validation time measures Node execution and hash checks using
  in-memory copies. It does not measure Worker D1 reads or any save/audit write.

Reads occur separately and do not form an atomic snapshot. Current validation
clock checks are retained; no earlier race time is substituted for a completed
race. Stale meeting evidence blocks discovery. Failed queries produce explicit
UNKNOWN/BLOCKED, without emitting raw errors. The existing preflight verdict is
not promoted by this additive report; queue activationReady is always false.

Before a production queue trial, separately verify/provision the audit schema
and measure actual Worker per-race D1 and audit-write costs under explicit bounded
trial settings. Choose inspection/attempt/window limits from those observations,
disable the legacy bridge, and then authorize a queue trial. This patch supplies
no numerical production defaults and does not switch either runtime path.

Production Activation remains NO-GO. The frozen MARKET audit, formal DATA-only
EARLY KPI and diamonds/warnings rules are unchanged. This phase generates no
prediction signals and cannot reconstruct past unrecorded race reasons.
