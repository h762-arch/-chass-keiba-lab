# Phase140.2: isolated read-only quality diagnostics

Base: Phase140.1a rollback, main fa22c22449717f7881f3a9558974ed523b05a44b.

## Scope and contract

`src/prediction/nar-quality-diagnostics.mjs` exports the synchronous pure function
`diagnoseNarRaceQuality(restoredData) -> {race, diagnostics}`. `race` is always
exactly the input reference, including when optional evidence access throws.
This module has no imports, IO, network requests, D1 operations, model calls or
runtime callers. Only tests import it in this phase. Existing row reconstruction,
validation, hash verification, quality audit, Viewer, status, Pack, writer,
configuration and signals are unchanged. Production API gains no diagnostics yet.

Pass a previously restored/validated snapshot's DATA object. Its horses have
string/null predictedTime; Viewer horses use a different shape and must not be
passed as DATA. A Viewer TIME object yields TIME_SHAPE_UNSUPPORTED. This is a
diagnostic projection, not a row validator or integrity verifier. Existing
invalid-row rejection remains mandatory. The race-preservation contract applies
to a restored race, not corrupt rows that have failed restoration/validation.

Diagnostics are returned separately; they must never be attached to immutable
DATA, Pack or hashes. No inferred probability, formal mark, diamond or warning
signals are generated. MODEL_HOLD, researchOnly=true, formalKpiEligible=false and
productionActivationReady=false remain unchanged.

## TIME observations

Known source reasons are allowlisted. A retained `time_missing_unknown` remains
UPSTREAM_REASON_UNKNOWN, even with zero parsed histories, no same-distance
observations or no same-track observations. These gaps are reported separately
as evidenceObservation, not as proven causes. Counts must be integers in 0..1000
and subsets must not exceed runCount. Invalid/missing counts are null.
Unavailable TIME evidence makes the exact missingActiveCount null; the known
observedMissingActiveCount and unavailableActiveCount are separate. Inactive
runners remain in details but are excluded from active TIME counts.

## History observations

Only schemaVersion=2 identity references are inspected. EPISODE_AMBIGUOUS and
EPISODE_LINK_UNMATCHED are counted as held references, not horses. RESOLVED with
null reason is excluded. Legacy/absent history, unsupported reasons/statuses,
malformed references and more than 100 references are UNAVAILABLE. Mixed
coverage is PARTIAL and exact race totals/reasonCounts stay null; missing data
must never be interpreted as zero. Empty retained reference arrays count as
zero observations, not proof of complete history or Rolling10 coverage.

Race input is bounded to 1..30 unique integer horse numbers. Unsupported
containers, runner statuses and identities yield UNAVAILABLE while preserving
the race. Optional per-horse evidence/history exceptions are isolated by section;
other diagnostic exceptions return DIAGNOSTIC_ERROR without raw exception text.
Only bounded allowlisted fields are projected; names, URLs, markets and raw
upstream fields are not copied. Valid JSON-like restored DATA is the intended
input; the function cannot bound arbitrary executable getters that never return.

## Verification and next gate

Tests cover deterministic/frozen inputs, non-aliasing diagnostic objects,
legacy/malformed evidence, unknown reasons, bounds, inactive runners, exceptions
and unsupported Viewer shapes. Synthetic 9 missing TIME / 32 held references
verify arithmetic only; they do not diagnose the reported production cases.
The 12-race regression uses the existing fake-D1 runner and real status/Viewer
readers, preserving rows/audits, counts and probability hold before/after offline
diagnostics, including forced diagnostic failure. It is not a production D1 test.

Before any later runtime integration, independently inspect retained production
DATA/appropriate read-only evidence and demonstrate a post-restoration boundary:
race return/count must not depend on diagnostic success. Do not place diagnostic
execution inside the row-rejection catch boundary. Keep identity/hash/Pack
verification failures distinct from diagnostic unavailability. Root cause of the
Phase140.1 production regression is not established merely by rollback success.

Reported production TIME-missing 9 horses and History-HOLD 32 references remain
user-reported aggregate targets; no production evidence or data was fetched,
modified or recalculated by this patch. No migration, deploy, flag change or
Production Activation is authorized by this artifact.

## Local results (2026-10-15 JST)

- New tests: 21 PASS (20 unit + 1 twelve-race regression).
- Related six-file suite: 94 PASS, 0 fail.
- Final `npm run check`: 1902 total, 1900 PASS, 2 fail.
- Remaining failures: jra-browser-smoke and viewer-nar-ability-browser require
  Chrome, which is not installed here. Full local check is therefore not PASS.
- Initial run also lacked MCP SDK; `npm ci --ignore-scripts --prefix mcp`
  resolved that environment failure. No dependency files changed.
- CI and production verification for Phase140.2 have not been performed.
