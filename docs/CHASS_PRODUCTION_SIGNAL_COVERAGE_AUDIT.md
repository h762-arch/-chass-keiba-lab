# Phase113: production saved Original Signal coverage

## Why this phase

Phase112 added the exact app Signal Reader. Production evidence still needs to
distinguish no app record, no Signal, provisional/invalid Signal and missing
retained Phase111 capture. No one of these states means all odds retrieval failed.
No fake manifest or retrospective Signal is constructed to improve coverage.

## Existing workflow integration

The existing JRA Production READ-ONLY Preflight script now invokes the additive
Signal coverage observer after the existing MARKET audit. No workflow file,
credentials, D1 schema, Worker flag, DATA Reader, model or save path changes.
One additional remote SELECT reads races for the validated target day:

```sql
SELECT race_id,model_version,market_json FROM races
WHERE race_id LIKE 'YYYYMMDD-JRA-%'
ORDER BY race_id,model_version LIMIT 101
```

The adapter supports 100 model records; the 101st is a truncation sentinel and
returns BLOCKED/APP_SIGNAL_ROW_LIMIT with UNKNOWN coverage. Duplicate race/model
rows, invalid identities and failed/non-array reads are BLOCKED, never empty
success. No raw DB exception, market payload, odds history or source payload is
printed. Output contains selection keys, statuses and sanitized reasons only.

Reuse the captured rows with Phase112's exact SELECT interface. No additional
remote per-race query. All model versions are observed separately; the adapter
does not choose a latest/best version or imply model-record counts are race counts.

Expected race IDs come from the existing MARKET audit only when its full expected
race list is available. Otherwise expected count/missing IDs stay unknown and
coverage=NOT_COMPARED. Missing app race IDs and unexpected saved app races are
reported separately. App races are a different storage path from precomputed
SOURCE/DATA/MARKET. A precomputed-only race can legitimately have no app row.

## Signal / receipt outcomes

- SAVED_RACE_MISSING: explicit selection has no app record (day aggregate reports
  missingExpectedRaceIds without inventing a model version).
- SIGNAL_SNAPSHOT_MISSING: app record has no saved Original Signal.
- SIGNAL_NOT_FROZEN / SAVED_SIGNAL_INVALID / SAVED_MARKET_INVALID: not a usable
  saved frozen Signal.
- BINDING_CAPTURE_MISSING: a structurally readable saved frozen Signal exists,
  but the production adapter has no retained Phase111 receipt capture.

This adapter currently passes no captures: there is no verified production
Source Registry/manifest read contract for Phase111. Do not treat this limitation
as evidence that no captures exist in any external archive. Missing captures
remain unverified; no content hashes are minted to excuse old edits.

OBSERVED means coverage reads completed, not formal Signal approval. Summary
separates app model records/distinct races, missing Signals/missing captures and
reasonCounts. The log also emits SIGNAL_BINDING_EVIDENCE_JSON for the next audit.
All outputs retain adopted=false/formalKpiEligible=false/productionActivationReady=false.

The new observation does not alter existing Preflight exit-code rules or core
Prediction KPI eligibility. Its own BLOCKED status must be checked explicitly;
a successful workflow is not proof of complete Signal coverage. This respects
v2.15.5's separation of core Prediction KPI and field-specific availability.

## Operation after PR/CI/merge

Run the EXISTING CHASS JRA Production READ-ONLY Preflight v1 on main with
target_date=2026-10-11. Inspect Phase113 summary and SIGNAL_BINDING_EVIDENCE_JSON
alongside Phase108/109 MARKET queue schema, odds diagnostics and MARKET coverage.
Do not enable MARKET Queue or formal Signal generation as a side effect.

Tests use synthetic captured rows and an injected SELECT executor. Production
D1 was not queried while authoring this patch; real counts remain unknown until
the existing workflow is manually dispatched and its logs are audited.

Authority:

- https://docs.google.com/document/d/1VivM-SpbiyKwJENk58wWlGdeBqGO0L1iapWXw4KQHhk/edit
- https://docs.google.com/spreadsheets/d/1dqFySEgG6cYEXIx8BmOw7tPOe7wI90H_No1FRoXlgoI/edit
  CHASS_統合適用ルール_v5 A1:H45, checked 2026-10-11 JST.
