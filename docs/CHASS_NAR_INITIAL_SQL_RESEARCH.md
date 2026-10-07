# NAR initial bundle SQLite research adapter v1

Isolated research. Production Activation NO-GO. No app/Worker wiring, D1 binding,
production schema/migration, official acquisition or mark assignment.

## API and schema

createNarInitialSqlStore({db,mode='off',clock=Date.now}) exposes get and
insertBundleIfBothAbsent for the existing initial research bundle module.
Modes: off, read-only, research-write. Schema creation is explicit and separate;
NAR_INITIAL_RESEARCH_SCHEMA_SQL creates only research_nar_initial_bundles.
The existing research_nar_early_snapshots table is also required. No automatic
migration or missing-table fallback is performed.

Injected db must provide async exec(sql), first(sql,args), run(sql,args), with
run returning {changes}. All calls must share one dedicated SQLite connection.
There must be no unrelated work/transactions on that connection. In-process
operations using this adapter serialize per db object; independent connections
are serialized by SQLite BEGIN IMMEDIATE. Fixed table names and bound values
are used. Arbitrary SQL/table names are not accepted from storage keys.

## Atomic insertion and timing

The bundle is semantically verified before transaction admission. Key pairing,
source acquisition, seal time and the actual saved post time constrain limits;
a widened post-time deadline cannot be supplied to bypass verification.

BEGIN IMMEDIATE holds the writer lock while both legacy and bundle keys are
checked. If either exists, ROLLBACK returns false without insertion. Otherwise
clock/freshness are checked, exactly one bundle row is inserted, clock/freshness
are checked again, and COMMIT follows. Backward, invalid, post-time or >60-second
clock at those checks rejects and rolls back the uncommitted row. Insert count
must be exactly one. Rollback failure is surfaced rather than reported as clean.

Important limitation: checks run immediately before COMMIT, not atomically with
the database's durable completion timestamp. An asynchronous driver's COMMIT
may complete after the deadline. This adapter does not prove a strict actual
commit-completion deadline, and does not fully certify that stronger requirement
in the initial bundle contract. No post-COMMIT deletion or clock repair is used.
Strict deadline enforcement is a separate unresolved integration requirement;
do not label it complete from these tests. Clock and supplied source hashes
also do not authenticate official data or trusted time.

## Persistence validation

10 new tests use real SQLite files via a dedicated Python sqlite3 process for
each connection. The parent retains a connection across BEGIN/SELECT/INSERT/
COMMIT calls. Persistence is checked after closing that connection and opening
a separate Node process, whose SQL reader opens SQLite in URI mode=ro. It
verifies the existing bundle, returns PRESERVED and the identical hash; the
original stored JSON remains byte-identical.

Other tests: reopened post-race capture performs SELECT only and no acquisition;
competing captures on independent connections preserve one atomic first row;
legacy insertion during acquisition wins; post-INSERT deadline failure rolls
back and releases the lock; backward/post-time clocks reject; persisted text
corruption rejects without repair; absent schema never auto-migrates; off/
read-only modes never write; mismatched key/deadline inputs reject.

The new suite plus initial bundle/pre-mark/V2/EARLY tests: 113/113 pass.
Full local check: 1165/1167 pass; missing Chrome and MCP SDK produce two failures.
Full local PASS is not claimed. CI results are unknown at patch preparation.
Synthetic race inputs and fixed test clocks are used; no real NAR fetch occurs.
The SQLite schema and connections are local research fixtures, not production D1.

## Scope and next work

Only this adapter, its integration test and this document are added. Existing
bundle, Freeze, pre-mark evaluator, old store and runtime settings are unchanged.
All bundle assessments remain INSUFFICIENT; candidate Signal remains WITHHELD.
Formal EARLY adoption, route/market/strong-support thresholds, warning scenarios,
full rule certification, production adapter and strict durable-commit timing
remain on hold. Production Activation remains NO-GO.

Reference main: 9eb18eb96205ba8176879ccc4dcf438a14cf266e (PR #135).
Policy source: uploaded "⚠️と💎の取り扱いルール.txt".
