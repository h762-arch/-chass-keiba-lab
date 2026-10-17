# EARLY prefreeze adapter v1 (offline research only)

This independent Node.js module splits declaration checks before a proposed save
from supplied evidence checks after a save. It is not wired into runtime, D1,
workflows, acquisition, signal assignment, or KPI aggregation. It performs no IO.

## Before save

`assessEarlyBeforeSaveV1(declarationsJson)` accepts bounded UTF-8 JSON text using
the existing gate's declaration schema. `freezeAt` means the planned cutoff.
G01/G02/G03/G04/G07 check race, roster, identity declarations, relative chronology,
and model declarations. G05/G06/G09/G10 are deferred: no nonexistent receipt is
fabricated. `DECLARATIONS_READY` is a structural research result, never permission
to save or freeze. Times are not checked against a trusted clock or current date.

## After save

`assessEarlyAfterSaveV1(savedJson, readbackJson, anchorJson)` accepts three separate
JSON strings, each at most 100,000 UTF-8 bytes. The first two must match byte for
byte. The offline envelope schema is `CHASS_EARLY_OFFLINE_EVIDENCE_V1` with
`raceId`, `snapshotId`, positive integer `revision`, `freezeId`, lowercase
64-hex `signalHash`, and full `declarations`. The anchor schema is
`CHASS_EARLY_OFFLINE_ANCHOR_V1` with the same five binding fields and
`artifactSha256` (SHA-256 of exact UTF-8 envelope text).

All candidate declaration gates must pass, with race/snapshot/freeze/signal IDs
bound to the envelope and anchor. Missing revisions never fall back to latest.
`LOCAL_BYTES_MATCH` certifies only the comparison and hash of supplied bytes.
Re-serialized equivalent JSON is deliberately a mismatch. This envelope is not a
D1 row and its artifact hash is not the domain-specific precomputed snapshot hash.
The nested snapshot hash and signal hash remain caller declarations.

## Remaining integration work

A future production integration must independently authenticate acquisition
evidence, canonical horse identities, the planned cutoff and actual freeze time,
model readiness, the original signal freeze, and the store/anchor origin. It must
read the exact stored revision and prove its relationship to snapshot and signal
hashes. Passing this offline module or constructing a matching anchor proves none
of those facts. In particular, providing the same string twice is not store
readback verification. The current adapter intentionally has no store port.

`precomputed-store.mjs` returns save/revision metadata and has a latest-snapshot
reader; neither is automatically an authenticated EARLY freeze receipt. Keep
pre-save checks before the save and post-save checks after an independently
verified exact-revision read. Do not feed fabricated readback flags into the
original gate to work around sequencing.

Every path preserves formal HOLD, `formalKpiEligible:false`,
`persistenceVerified:false`, `acquisitionCertified:false`,
`earlyFreezeVerified:false`, `externalAnchorAuthenticated:false`, unknown actual
immutability, MODEL_HOLD and NO-GO. Original Signal Freeze remains immutable;
later market/result information is supplementary. Tests use synthetic inputs,
not official-source or production evidence.

Run `node --test tests/early-prefreeze-adapter-v1.test.mjs
tests/early-prefreeze-gate-v1.test.mjs` and `npm run check`. Apply only the three
files in this patch. Existing runtime, D1 and workflow files remain unchanged.
