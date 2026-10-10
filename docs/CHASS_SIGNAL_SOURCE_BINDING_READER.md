# Phase112: exact saved Original Signal read adapter

## Existing storage and boundary

`migrations/0001_research_cloud.sql` defines `races` with primary key
(race_id,model_version) and market_json. Existing app save/read code stores
marketSnapshot.signalSnapshot there. This is the app research storage path,
not precomputed_race_snapshots or the DATA-only formal JRA EARLY Reader.
Repository inspection does not prove that production currently has complete
Signal records or Phase111 manifests/Source Registry captures.

The existing app save path does not automatically persist Phase111's capture
contract. This patch adds no schema and does not pretend those receipts exist.
An old Signal without retained receipts stays BINDING_CAPTURE_MISSING. A saved
MARKET layer alone is not a saved Original Signal and is not promoted into one.

## D1 read API

`readSignalSourceBindingCohort({DB,selections,cryptoImpl})` takes 1..100 explicit
selections `{raceId,modelVersion,capture?}`. Each selected race/model pair is unique.
No latest-model discovery or retrospective choice of a more convenient snapshot.
Only query:

```sql
SELECT race_id,model_version,market_json FROM races
WHERE race_id=? AND model_version=? LIMIT 1
```

Selections are cloned before I/O and sorted deterministically. Read one row per
pair; DB exceptions produce BLOCKED/D1_READ_FAILED with sanitized output. No
schema creation/repair, results, current odds, official cache or save API is used.

Saved row keys and optional market raceId must agree with selection. Read only
market_json.signalSnapshot; reject malformed market JSON, preserve missing vs
provisional Signal reasons. market_json is limited to 2 Mi characters per row.

The capture is Phase111's already retained JSON plus
`storage:{raceId,modelVersion}`. Both capture scope.raceId and storage keys must
match the exact selection. Hash the saved Signal and compare to the retained
manifest.snapshotHash, then invoke Phase111 to verify its captured snapshot,
Evidence Ledger, survival reviews and Source Registry against that same manifest.
Never replace capture.snapshot with DB data and generate new manifest hashes.
The storage selection is an adapter binding, not an independently authenticated
manifest signature or proof that that model produced the capture.

## Outcomes

Top status OBSERVED means selected reads completed, not all records passed.
Per pair: STRUCTURAL_PASS / UNVERIFIED / VIOLATION / REJECTED.
Missing race, missing Signal, Signal not frozen, missing binding capture,
storage identity conflict and saved Signal content conflict have distinct reasons.
Phase111 READY can contain Signal violations; this Reader surfaces them rather
than presenting content binding as Signal approval. reasonCounts summarize
per-pair outcomes; nested audit rows retain detailed horse-level reasons.

All outputs remain research-only, authenticity=NOT_VERIFIED, adopted=false,
formalKpiEligible=false and productionActivationReady=false. Unknown receipts
are not negative evidence. Signal audit failure does not alter core Prediction
KPI eligibility. Each exact row read is atomic, the overall cohort is not.

## Offline execution

Export only the selected race/model rows using the SELECT above. rows.json is
an array of `{race_id,model_version,market_json}`; market_json is the original
stored JSON text, not a reconstructed snapshot. selections.json is an array of
explicit `{raceId,modelVersion,capture?}` selections. Attach capture only if the
original immutable receipts were actually retained. Do not mint a receipt now
for an old prediction. Omit capture to diagnose existing coverage honestly.

```sh
node scripts/audit-signal-source-bindings.mjs --rows rows.json --selections selections.json
```

Offline stdout only, 16 MiB per input file, 100 exported rows maximum, duplicate
race/model rows rejected. Exit0 all selected rows structurally pass; exit1 input
or read failure; exit2 rejection/violation; exit3 missing/unverified evidence.
Exit0 still does not approve source authenticity, scenario quality or production.
No remote/apply switches, credentials, dynamic SQL, output files or side effects.

## Validation and remaining work

Synthetic tests exercise exact SELECT/bind, identity/content edits, retained
Source payload mismatch, survival veto, incomplete independence, read errors,
multiple models, malformed/provisional/missing records, ignored later odds, CLI
input preservation and failure exit codes. Production D1 reads were not executed
as part of this patch. No completed real cohort or production coverage is claimed.

The next operational audit needs explicitly selected real saved row exports and
any independently retained manifests. The trusted Source Registry retrieval and
capture producer are still unimplemented. New forward captures need a separately
reviewed append-only persistence contract; retrospective backfill is forbidden.
Formal Signal generation, original DATA Readers, probability/EV promotion and
MARKET queue activation/timing are unchanged.

Authority:

- https://docs.google.com/document/d/1VivM-SpbiyKwJENk58wWlGdeBqGO0L1iapWXw4KQHhk/edit
- https://docs.google.com/spreadsheets/d/1dqFySEgG6cYEXIx8BmOw7tPOe7wI90H_No1FRoXlgoI/edit
  CHASS_統合適用ルール_v5, A1:H45 read on 2026-10-11 JST.
