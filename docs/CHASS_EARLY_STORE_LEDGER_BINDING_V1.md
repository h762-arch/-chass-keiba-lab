# EARLY store / save-record / ledger binding v1

Independent read-only orchestration; no runtime hooks, production D1 access,
writer, workflow, migration or signal changes. This is a structural evidence join,
not authenticated formal adoption.

`readEarlyStoreLedgerBindingV1(DB, evidenceJson, pinJson)` accepts bounded JSON
text, a supplied D1-style read port, and independently supplied pinned bindings.
Evidence JSON contains `saveRecord`, `ledgerBundle`, `ledgerAnchor`.

The record schema `CHASS_EARLY_SAVE_RECORD_V1` requires recordId, organization
(JRA/NAR), raceId, positive integer revision, sourceHash, inputHash, snapshotHash,
runId, freezeId and ISO savedAt with explicit timezone. This is a proposed
integration record format; existing savePrecomputedSnapshot does not emit it.
An original save record must be obtained independently; this module never creates
one or converts a SUPERSEDED/no-op response into proof of a new save time.

The ledger uses existing CHASS_PREDICTION_KPI_LEDGER_BUNDLE_V2155_V1 and its
VERIFIED_PREDICTION_KPI_INPUT_ANCHOR_V1 structure. The legacy word VERIFIED is a
schema label; this module does not authenticate its origin. The existing assessor
must return POLICY_READY after checking all five sections and policy conditions.

Pin schema `CHASS_EARLY_STORE_LEDGER_PIN_V1` requires organization, raceId,
revision, snapshotHash, runId, freezeId, saveRecordSha256, ledgerBundleSha256.
Both hashes use the existing predictionKpiLedgerSha256 canonical JSON algorithm.
All identities, hashes and freeze joins must agree. Do not derive this pin from
the same untrusted evidence to claim independent authentication.

After these checks, one exact revision SELECT is performed through the previous
readback module. SOURCE/input/snapshot hashes are recomputed against the record.
Its output now also exposes sourceValidatedAt/dataCalculatedAt, which are covered
by the snapshot hash. The order required is:
sourceValidatedAt <= dataCalculatedAt <= savedAt <= core.frozenAt < core.offAt.
Invalid dates, missing timezone, later saves and earlier-than-calculation saves
hold. Equality is allowed until the strict pre-start cutoff. This is relative
chronology only, not trusted-clock or current-day validation.

The ledger core's snapshotHash describes its separate prediction contract. It is
not substituted for the precomputed snapshotHash. Pinning both artifacts proves
the declared relationship, not that DATA generated the original signal. Actual
signal payload provenance and Original Signal Freeze authentication remain open.
No offline envelope/readback booleans are synthesized for previous gates.

Successful status STORE_LEDGER_BINDINGS_MATCH means content and declared joins
match. Every result keeps formal HOLD, MODEL_HOLD, NO-GO, formalKpiEligible false,
persistenceVerified false, earlyFreezeVerified false, acquisitionCertified false,
externalAnchorAuthenticated false, actual immutability unknown, freezeMutation
NONE. Later market/results cannot replace original EARLY through this module.

Evidence is at most 500,000 UTF-8 bytes; pin at most 4096; parsed JSON has at most
30,000 nodes and depth 32. The underlying SELECT has a 5-second wait limit; it
cannot cancel a pending read port operation. Hash-covered timestamps are checked
after readback. Raw content/errors are not returned.

Tests use synthetic five-section ledgers and in-memory SQLite through the existing
save function. No official acquisition or production record was used. Future
integration must supply a trusted store and independently authenticated save
record, pin, source evidence, model lineage and original signal receipt. This patch
does not grant that authority or wire the runtime.

Run node --test for tests/early-store-ledger-binding-v1.test.mjs together with
tests/early-revision-readback-v1.test.mjs, precomputed-store/snapshot tests,
prediction-kpi-ledger-adapter-v2155 and prediction-kpi-contract-v2155 tests.
Run npm run check for full regression.
