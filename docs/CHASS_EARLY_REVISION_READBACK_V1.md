# EARLY exact revision readback v1

Independent read-only module; no production wiring, schema change, migration,
writer, workflow change, or change to existing EARLY modules.

`readEarlyExactRevisionV1(DB, expectationJson, {timeoutMs:5000})` performs one
parameter-bound SELECT on organization, race ID and exact positive integer
revision. Missing rows hold; there is no latest fallback. The supplied port must
provide D1-style `prepare().bind().first()`. No `run()` is used.

The expectation is JSON text, at most 4096 UTF-8 bytes:

```json
{
  "schemaVersion": "CHASS_EARLY_REVISION_EXPECTATION_V1",
  "organization": "JRA",
  "raceId": "the-exact-race-id",
  "revision": 1,
  "sourceHash": "replace-with-64-lowercase-hex",
  "inputHash": "replace-with-64-lowercase-hex",
  "snapshotHash": "replace-with-64-lowercase-hex"
}
```

The placeholders above deliberately fail validation. Use original pinned hashes
from an independently authenticated save/evidence record, never values taken from
the same readback being checked. A save result's revision alone is insufficient;
SUPERSEDED does not establish that the proposed content was saved.

The reader detaches bounded scalar database columns without invoking accessors,
checks row identity and revision, restores existing separated layers using
`d1RowToSnapshot`, recomputes SOURCE/input hashes using
`createPrecomputedIdentity`, and recomputes the snapshot hash using
`createSnapshotHash`. All three hashes must match both stored and expected values.
It returns only binding/hash metadata, not SOURCE content or raw errors.

The successful status is `EXACT_REVISION_CONTENT_MATCH`. This is semantic content
hash verification, not a byte-for-byte file comparison. Source identity uses the
existing transient-metadata exclusion rules. The snapshot hash includes layers,
input identity, status, validation and DATA calculation times. It does not cover
every row column (e.g. created_at); this module does not certify row-wide bytes,
freshness, current-day eligibility, semantic model correctness, market independence,
or official-source authenticity.

The IO wait is bounded to 1..5000 ms (default 5000). Timeout stops waiting; it
cannot cancel an underlying port operation. The reader never writes. Detached row
string values total at most 1,000,000 UTF-8 bytes, parsed layer values at most
30,000 nodes and depth 32. These bounds also constrain subsequent hashing work.

Supplied DB and expectation origins remain unauthenticated. Every result preserves
formal HOLD, MODEL_HOLD, NO-GO, no formal KPI eligibility, no acquisition or EARLY
freeze certification, and unknown actual immutability. A matching precomputed
snapshot is not an original EARLY Signal Freeze receipt.

This does not generate the previous adapter's offline evidence envelope or set its
readback booleans. Future integration must connect a trusted store, independently
pinned save record, acquisition evidence and original signal freeze. Original
signals remain immutable; later market/results stay supplementary.

Tests use the existing migration and real in-memory SQLite through the existing
savePrecomputedSnapshot path, including a newer revision present when reading an
older pinned revision. They do not access production D1 or official sources.

Run `node --test tests/early-revision-readback-v1.test.mjs
tests/precomputed-store.test.mjs tests/precomputed-snapshot.test.mjs
tests/early-prefreeze-gate-v1.test.mjs tests/early-prefreeze-adapter-v1.test.mjs`.
Run `npm run check` for full regression.
