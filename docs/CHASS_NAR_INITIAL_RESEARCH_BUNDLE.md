# NAR initial research bundle v1

Isolated composition/storage contract only. Production Activation NO-GO.
No app/Worker wiring, D1 adapter, runtime flag, mark assignment or KPI promotion.
Existing Freeze, v1 EARLY store, V2 and pre-mark evaluator are unchanged.

## Meaning of the bundle

This is the first immutable *research bundle*, not a new formal EARLY/Signal
schema. It contains the original source EARLY reference, its sealed snapshots,
ability projection, pre-mark assessments and a WITHHELD candidate Signal.
All valid assessments currently remain INSUFFICIENT; candidateMark is null.
Original legacy marks are preserved as source references, never adopted by
this new policy. The existing app acquisition may already have assigned those
legacy marks; therefore this composition does NOT certify the formal order
scenario -> mark -> Freeze. Full warning/diamond rules remain unimplemented.

The source EARLY object is constructed in memory after research evaluation,
inside the same call, and is never written to the legacy EARLY key. The outer
bundle seals all research content at once. Nothing is appended after storage.
Its SHA-256 is a content/contract check, not authentication of data or clocks.
No cyclic self-hash: assessments refer to the ability projection hash only.

## API

- captureNarInitialResearchBundle({enabled,store,raceId,acquire,clock})
- readNarInitialResearchBundle({store,raceId})
- verifyNarInitialResearchBundle(snapshot,{raceId})

OFF by default. Acquire is injected and must return a fresh receipt:
{record,acquiredAt,acquisitionKind:'fresh'}. record is the existing complete
source-sealed NAR record, and race.narSourceAcquiredAt must equal acquiredAt.
The complete market/Signal must identify every prediction runner, with finite
positive actual odds and integer popularity within field size. Rank >=6 selects
research assessments; it does not assign a mark. Ties in ranks are permitted.
Missing market coverage rejects this composition rather than inventing values.

The ability projection never receives old marks, odds, popularity or EV. Final
source Freeze rejects results/historical references, bad identities, source
seals, invalid dates and pre-post/freshness violations. Original source seals
are checked as supplied, never repaired.

## Storage contract and cross-namespace exclusion

store.get(key) returns the original JSON string or null.

store.insertBundleIfBothAbsent(legacyKey,bundleKey,json,limits) must atomically:
1. Check both keys are absent in the same transaction.
2. Check actual commit time >= limits.notBefore, < limits.notAfter, and no more
   than limits.maxAgeMs after limits.acquiredAt. A clock error/expired deadline
   must reject before writing.
3. Insert only bundleKey if all conditions pass. Return true for inserted,
   false if either first version already exists; throw on failure.

legacyKey: nar-early:v1:<raceId>
bundleKey: nar-initial-research:v1:<raceId>

A normal insertIfAbsent adapter is explicitly insufficient. There is no
non-atomic fallback. This module passes deadline constraints and rechecks them
immediately before the call. Transaction-level enforcement is the injected
adapter's responsibility; a production implementation has not been supplied
or verified. The test adapter uses memory, and the delayed-commit test enforces
a refused deadline. Do not claim production database atomicity was tested.

Before acquire/evaluate/write, read both namespaces. A valid legacy row is
returned as PRESERVED / LEGACY_EARLY without migration. A valid research row is
returned as PRESERVED / INITIAL_RESEARCH. A corrupt first row fails closed.
Both present is ambiguous and rejected, not merged or fallen forward.

Concurrent losers read the atomic winner, including a legacy EARLY inserted
during acquisition. Insert true must read back the exact candidate hash; missing,
corrupt, different or malformed-contract readback is rejected with no retry.
The module has no overwrite/delete API.

## Time and semantic readback

New capture enforces real caller clock monotonicity, receipt between start and
evaluation, 60-second freshness through final sealing and immediately before
storage, plus source pre-post gates. Deadlines are passed to the atomic adapter.

Reader verifies outer hash, source contract, saved acquisition/evaluation/seal
order, pre-post saved seal time, fresh saved times, projection, assessments,
withheld candidate Signal and all research flags. It reconstructs deterministic
saved-time semantics; it does not change Date.now, fetch again, create a new
persisted record or apply today's market. A valid saved pre-post bundle remains
readable after the race. Saved-time reconstruction is not proof of a trusted
clock or resistance to an attacker who can replace the entire source and hashes.

## Validation and limits

16 new synthetic-input tests cover initial composition, immutable source/Signal,
disabled mode, replay without acquire/clock, legacy preservation, corrupt rows,
cross-namespace contract, concurrent winners, legacy insertion race, rehashed
semantic tampering, invalid receipts, final/commit freshness, result/source-seal
rejection, ambiguous keys, bad readback and delayed adapter deadline rejection.

This stage performs no actual NAR acquisition and no production persistence.
Route/market/strong-support criteria remain unapproved. Formal Signal creation,
warning fourth-or-worse scenarios, full exclusion policy, actual persistent
adapter/reopen integration and real-world efficacy are not certified.

Reference main: 22b20eca8023dba945494b07b87b8f0577cabb6c (PR #134).
User policy source: uploaded "⚠️と💎の取り扱いルール.txt".
