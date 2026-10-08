# Phase79: NAR Master Evidence Adapter v1

Research-only offline transformation. Formal EARLY HOLD; Production Activation NO-GO.

## Purpose

Normalize the actual NAR_指数マスター and NAR_近10走マスター header contracts
into Phase77 unified race/runner/history tables. SourceRace_ID must be supplied
explicitly with its canonical association; cross-race horse-number joins are
forbidden. No Google Drive runtime, production write, model change or deploy
is introduced. Inputs and source archives remain unchanged.

The adapter retains source row references and namespace-prefixed horse IDs.
Exact archive race/number/name/unique-ID agreement is an archival association,
not independent identity authentication. The downstream PASS identity declaration
is explicitly ARCHIVE_ASSOCIATION_UNAUTHENTICATED; formal eligibility stays false.
Name disagreements need a separately evidenced exact source/canonical race,
number, both names and source-ID association. No fuzzy matching or auto aliases.
Starter status requires separate named evidence. Presence in an index/history
master never implies ACTIVE. Missing statuses remain UNKNOWN and overall HOLD.

Excel serial dates are normalized. Plain numeric index values remain on their
original scale. Values like 10*, 55*, 末 and - are not stripped into scores:
they remain null with missingIndexFields and raw source evidence. Current odds,
popularity, old marks and historical popularity are not projected into DATA.
Duplicate runners/history slots, reused IDs, current/future history and conflicting
race context reject. Unresolved runner histories are withheld; they do not enter
another horse's features. TrackCondition_EARLY stays UNKNOWN because these two
masters do not establish it. READY_FOR_UNVERIFIED_RESEARCH_SNAPSHOT is not formal
readiness; source revision/timing, track context and downstream gates still apply.

## Real audit, 2026-10-08

Canonical Drive:
https://docs.google.com/spreadsheets/d/1dqFySEgG6cYEXIx8BmOw7tPOe7wI90H_No1FRoXlgoI/edit

Current metadata was checked. Index identity-column search located exactly 13
20260914_OOI_12 rows; NAR_指数マスター A793:AA805 was read. History identity-
column search located 129 rows; NAR_近10走マスター A1:AI130 was read.
No source row was edited. This is retrospective research on 2026-09-14, not a
new pre-race observation or proof of EARLY availability.

| Audit | Observed result |
| --- | --- |
| Source race | 20260914_OOI_12, 大井12R, 1600m dirt |
| Canonical candidate | 20260914-NAR-OI-12 |
| Index runners | 13 |
| Historical rows | 129 |
| Exact archive associations | 11 |
| Unresolved names | 2 |
| Unconfirmed starter statuses | 13 |
| Overall | HOLD |

Horse #4: index プロローグ, history プロローク, source ID 30013400407.
Horse #8: index ハイグンス, history ハイケンス, source ID OP-2021102813.
Neither disagreement is automatically certified as a typo or alias. Public NAR
race-card retrieval did not provide verification in this session. No official
identity/status verification is claimed. All 13 statuses remain UNKNOWN.

No real Snapshot was admitted and no real before/after NAR prediction comparison
was run. Dropping the two unresolved runners would change the field distribution
and cannot stand in for a verified 13-horse comparison. The audit artifact retains
raw connector exports and per-horse row references so the issues can be resolved.
No profit, calibrated probability, signal or improved prediction is claimed.

## Integration and next evidence

The returned races/runners/history/identityMap shape can be passed to Phase77
only after association/status failures are resolved and source provenance,
pre-race timing and race context are supplied. Phase78 remains the actual NAR
consumer. Its raw-index research policy requires its own snapshot/run/model
association; this adapter does not manufacture that approval. Original Signals,
EARLY Freeze and Ticket layers remain unchanged. User diamond/warning fixed
rules remain authoritative; no signals are generated here.

Resolve the two name disagreements with independent lineage/source records,
obtain explicit starter statuses and race conditions, and preserve authentic
pre-race versions for a forward cohort. Then run all 13 horses through the
Snapshot and NAR consumer with attributable baseline and family ablations.
Historical exports remain retrospective even after identities are resolved.
