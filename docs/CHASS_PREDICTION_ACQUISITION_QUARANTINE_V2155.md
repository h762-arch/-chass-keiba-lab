# Phase91: isolated acquisition evidence persistence

Base main: c2e1b8a73134a87bc5206c0a4e6c19735a345cbc (PR157).
Authority: v2.15.5 Acquisition-First / CONTRACT_V04, as recorded in the
2026-10-09 development handoff. This patch does not invent field thresholds.

## Implemented scope

Node-only `executeAndQuarantinePredictionAcquisitionV2155` calls the Phase90
executor, then saves its detached plan and complete output together in one
canonical JSON document. The output contains the field acquisition state and
actual attempt records, including HOLD and declared exhaustion. The original
executor result remains persisted=false; the surrounding receipt describes only
this local quarantine write/readback. Formal adoption flags remain false.

The caller must explicitly select environment QUARANTINE and supply a dedicated,
trusted local root. No default root, production root, D1, Drive, network collector,
Worker integration, scheduler, KPI reader or activation is added. The string
QUARANTINE cannot authenticate a directory; caller ownership and isolation are
external obligations. Do not use a shared or attacker-controlled root.

Plan IDs are restricted and SHA-256 encoded for paths. A private staging directory
contains the whole document; a directory rename publishes it as one unit. An
existing nonempty destination is never replaced. Exact repeat receipts may be
read back idempotently; different receipts under the same plan ID return HOLD.
Concurrent differing writes publish one winner, without mixing attempts/states.
This is atomic publication on the local filesystem, not crash-durable or remote
transaction evidence: fsync, external anchoring and offsite persistence are absent.

`readPredictionAcquisitionQuarantineV2155` requires the separately retained anchor
returned from the initial write. It validates plan/payload hashes and binding IDs,
then returns a frozen payload. It does not discover an anchor from stored bytes.
A new Node process verifies disk content without relying on an in-memory cache.
Modification, wrong anchor, missing file, invalid JSON, or failed write/readback
returns HOLD with persisted=false/readbackVerified=false; underlying write may
have occurred, so failure is never a proof that no disk data exists.

Hashes provide content integrity relative to a trusted retained receipt, not
source authentication, a formal Freeze, or eligibility for KPI. Caller must verify
provider identity/availability and independently retain the anchor. Phase90 FOUND
output is retained exactly; the full provider source snapshot is not stored here.
The source ledger and externally verified anchor remain separate requirements.

## Validation

Ten new synthetic tests cover exhaustion, zero, HOLD, tampering, wrong anchors,
idempotency/conflict, concurrent publication, environment guard, plan detachment,
invalid inputs and reconnect in a fresh Node process. Related Phase88-90 tests
are run with the new tests. No live race, authenticated source registration,
remote save, formal Prediction Freeze or KPI adoption is claimed.

## Next connection

Confirm a specific forward race, frozen field contract and Source/Identity registry.
Register real collectors and preserve full source snapshots. Connect isolated
remote/DB atomic writes and reconnect receipts; independently validate Core,
Final5/Role and Original EARLY Freeze before formal adoption. This local component
is one preparatory step, not completion of that connection. Activation stays NO-GO.
