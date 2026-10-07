# NAR commit observation and admission research v1

Research only. Production Activation NO-GO. No app/Worker wiring, D1 binding,
production migration, formal mark change or runtime activation.

## Separate preservation from adoption

The existing initial bundle remains byte-identical and readNarInitialResearchBundle
still reports PRESERVED when its saved source/content semantics verify. This
module adds a separate SELECT-only research gate. It never returns formal GO,
adopted=true or formalKpiEligible=true. Existing source flags and Signal are not
changed. An observed in-window driver return also remains HOLD: actual durable
time and formal route/market policy have not been certified.

## Observer API

observeNarSqlCommitResearch({db,clock}) returns {db,observations()}. Its wrapped
db forwards first/run and exec statements. Only the exact COMMIT statement is
observed. It samples application time immediately before the call and after
resolution/rejection. Outcome is RESOLVED or REJECTED; clock exceptions,
non-finite, negative or non-integer values become null. Original driver errors
are rethrown unchanged, but error messages/details are not included in evidence.
Returned event copies are deeply frozen. No statement or transaction is added.

Use one dedicated SQLite connection and one capture at a time. Complete the
capture before collecting observations. Multiple events must not be silently
reduced to one, and no event must not be inferred from sealedAt. For lost
acknowledgements, reload the preserved content before explicitly saving its
event. The observer does not know whether a rejected call committed; its
REJECTED event is always timing UNKNOWN.

Application-clock samples and hashes are not authenticated storage timing.
The caller associates an event with a snapshot; this association is not an
authenticated transaction identifier. This is acceptable only for isolated
research observations and must not be upgraded to formal certification.

## Immutable observation journal

saveNarCommitObservationResearch({enabled=false,snapshot,observation,receiptStore})
verifies the initial research bundle, binds evidence to raceId and its exact
contentSha256, then stores a separate receipt. No source-store method is called.
The receipt includes source acquisition/seal/post limits, its own SHA-256,
researchOnly=true and trustedDurableTime=false. Existing valid first evidence
is preserved even if a later caller offers a more favourable observation.
Malformed existing evidence rejects without replacement or repair.

receiptStore.get(key) must return string|null; insertIfAbsent(key,json) must be
atomic across connections and return a boolean. On insertion, readback must
verify and match the newly written receipt hash. A concurrent losing writer
reads and preserves the valid winner. The key is
nar-commit-observation:v1:<raceId>:<sourceBundleSha256>.

Schema and storage remain injected. Only tests explicitly create the local
research_nar_commit_observations table and use SQLite INSERT OR IGNORE. This
module supplies no production schema, automatic migration or D1 adapter.
Audit save failures do not delete, update or retimestamp the original bundle.
If a write committed before its acknowledgement failed, the save API can report
REJECTED; a later read still must verify whatever evidence actually exists.

## Read admission API and interpretation

readNarInitialAdmissionResearch({store,receiptStore,raceId}) first verifies the
saved source using the unchanged bundle reader. It performs no acquisition,
insertion, update, deletion or regeneration. Missing source stays MISSING;
invalid source stays rejected. Legacy EARLY is HOLD/LEGACY_TIMING_UNCONFIRMED,
without querying the new evidence namespace.

| Evidence | Timing | Gate |
| --- | --- | --- |
| Missing/unavailable journal | UNKNOWN | HOLD |
| REJECTED/UNOBSERVED, null, reverse or pre-seal clock | UNKNOWN | HOLD |
| RESOLVED, ordered clock, return age >60,000 ms or return >= post time | OBSERVED_OUTSIDE_WINDOW | HOLD |
| RESOLVED, ordered clock, return age <=60,000 ms and return < post time | OBSERVED_WITHIN_WINDOW | HOLD |
| Bad JSON, receipt hash/schema, source binding or trust-flag tampering | Not accepted | REJECTED |

All outputs retain formalKpiEligible=false and adopted=false. Saved receipt
verification recomputes the expected body from the verified original bundle;
a rehashed source-hash substitution or trustedDurableTime=true cannot pass.
Hashes detect content changes but do not prove who wrote the observation.
A party able to rewrite observations and their hashes can fabricate application
times; even a verified receipt cannot establish trusted physical durability.

Unknown first evidence is not replaced by later claims. A future trusted timing
contract, formal adoption policy and any independent later assessment namespace
remain separate, unimplemented work. This module does not fix the actual
asynchronous COMMIT deadline gap characterized by PR #137.

## Validation and scope

New tests use real file-backed SQLite with synthetic race/source inputs and
injected clocks. They cover journal restart preservation, late commit, exact
post time, inclusive sixty-second freshness, missing/unavailable evidence,
lost acknowledgement, write failure, immutable unknown first evidence,
source/hash/trust tampering, disabled/invalid inputs, invalid clocks, legacy
preservation and competing independent journal connections.

The existing store and all six deadline-characterization tests are unchanged.
No real official acquisition or production D1 test is performed. Full rule
certification and formal EARLY eligibility remain HOLD. Production Activation
remains NO-GO.

Baseline main: be3c81c63fff7445758761c5199707c71f2de809 (PR #137).
Policy source: supplied "⚠️と💎の取り扱いルール.txt".

Local validation: 14 new tests pass; SQLite suite 30/30 and related research
suites 133/133 pass (overlapping counts). Full npm run check: 1185/1187 pass;
the two failures are missing Chrome and missing MCP SDK in the local environment.
Full local PASS is not claimed. GitHub CI for this patch is not yet run.
