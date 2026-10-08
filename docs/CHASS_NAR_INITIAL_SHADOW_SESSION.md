# NAR initial shadow session research v1

Research only. Production Activation NO-GO. No app/Worker wiring, D1 binding,
production schema, automatic acquisition trigger, mark change or formal adoption.

## Entry point

runNarInitialShadowSession({enabled=false,db,receiptStore,raceId,acquire,clock})
joins the existing bundle capture, SQLite store, COMMIT observer, immutable
observation journal and HOLD-only admission gate. It defaults to DISABLED and
performs no I/O when disabled. Schema creation remains an explicit external
setup step. db requires exec/first/run on one dedicated SQLite connection;
receiptStore requires get and atomic insertIfAbsent. acquire returns the existing
fresh NAR research receipt contract. Tests use synthetic inputs, not official
production race acquisition.

Sessions serialize per supplied db object for their full capture/audit/read
lifetime. Other work must not use that dedicated connection concurrently. This
local queue does not coordinate unrelated wrappers or processes; SQLite writer
locking still governs independent connections.

## Initial read and capture

The entry first runs the unchanged admission reader. A preserved initial bundle
or legacy EARLY returns its existing HOLD/REJECTED result with captureStatus and
auditStatus NOT_RUN. No acquisition, insertion, schema creation, receipt recovery
or favourable evidence regeneration is attempted. Missing audit evidence stays
missing. A missing initial bundle proceeds only if write/acquisition contracts
are complete. Missing schema and corrupt saved content fail before acquisition.

On a fresh capture, the wrapper records the exact storage key and JSON bytes
only after the known initial-bundle INSERT reports changes=1. That pending
target is associated with the COMMIT attempt. Exactly one observed COMMIT and
one non-null target are required. The entry reloads the semantically verified
bundle and compares the stored bytes to those exact inserted bytes before
saving evidence. It does not assign an event to whichever row happens to be
present. A losing capture with no insert/COMMIT creates no evidence for a winner.
Changed valid bytes report TARGET_MISMATCH, while invalid/missing source reports
SOURCE_UNCONFIRMED. Neither path repairs content or invents a receipt.

This associates an observation with the attempted content, not an authenticated
database transaction identity. It remains a research association. It does not
prove which physical transaction produced a row after an ambiguous error.

## Failure and reread behavior

A COMMIT acknowledgement can fail after SQLite has committed. When the exact
attempted bytes still exist and verify, the entry saves the REJECTED driver
observation as timing UNKNOWN and returns HOLD. Capture rejection alone is not
used as evidence that no row exists. A failure before COMMIT that rolls back
has no preserved source and creates no receipt. If final admission is MISSING
after a rejected capture, the session reports REJECTED with that capture reason.

An evidence-save failure retains the original content and leaves admission
HOLD or REJECTED according to the actual journal read. A later session does not
reconstruct evidence from seal time. No UPDATE, DELETE, retry acquisition,
clock correction, post-COMMIT repair or source re-Freeze is introduced.

## Result and limits

The result contains status/reason, researchOnly=true, formalKpiEligible=false
and adopted=false. Active sessions also report captureStatus, auditStatus,
commitObservationCount and the independent admission result. Diagnostics do not
include raw driver error messages. There is no formal GO/CREATED session result;
successful storage can coexist with HOLD admission. Existing source and journal
verification failures remain REJECTED, and absence remains MISSING unless the
capture explicitly failed.

Application-observed return time is not physical durability time. Journal hashes
do not authenticate clock, source origin or observation author. Even in-window
evidence remains HOLD under the existing research gate. The actual asynchronous
COMMIT deadline gap, trusted timing/transaction identity, formal route/market
policy, production D1 adapter and formal EARLY adoption remain unresolved.

## Tests and scope

Eleven new tests use actual SQLite files with synthetic source data and clocks:
disabled/invalid contracts; complete capture/evidence/restart; late COMMIT;
lost acknowledgement; pre-COMMIT failure; journal failure with no later evidence
invention; independent-connection winner without event misassignment; serialized
same-connection sessions; corrupt post-COMMIT source; legacy preservation; and
replacement by another semantically valid bundle with no target misassignment.

Related research suites: 144/144 pass. Full local npm run check: 1196/1198 pass;
Chrome and MCP SDK are absent, causing two failures. Full local PASS is not
claimed. GitHub CI for this patch is not yet run. Existing deadline tests, store,
observer, admission gate and Freeze implementations are unchanged.

Only this module, document and existing SQLite integration test change.
Baseline main: 67a062afaa9ee461512b32b7f0b5df27865d5886 (PR #138).
Policy: supplied "⚠️と💎の取り扱いルール.txt" and initial Signal immutability.
