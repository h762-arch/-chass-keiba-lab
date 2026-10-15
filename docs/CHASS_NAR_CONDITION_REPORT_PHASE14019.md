# Phase140.19: retained material condition report

Base: af4e3d349cee871094775c89de0e737e6afe6639 (merged PR #222).

## Purpose

Phase140.17 validates the diagnostic history origin but its sanitized output
aggregates every non-NAR reference under ORIGIN_NOT_NAR. That category cannot
establish whether a reference was JRA, another circuit, or unavailable.
This standalone report retains those validated categories separately and
counts TIME conditions without converting observations into causes or repairs.

Only four new files are added: this document, a pure research module, a CLI,
and tests. No Worker, D1, runtime flag, collector, schedule or workflow changes.

## Invocation and evidence boundary

```sh
node scripts/report-nar-material-conditions.mjs --bundle /absolute/path/bundle.json --diagnostics /absolute/path/diagnostics.json --date 2026-10-15
node scripts/report-nar-material-conditions.mjs --bundle /absolute/path/bundle.json --diagnostics /absolute/path/diagnostics.json --date 2026-10-15 --historical
```

Inputs are the original mirror bundle and the raw compact diagnostic response,
not a Phase140.18 reader output, acceptance result, investigation plan or prior
report. Each CLI file must be a regular file of at most 1,000,000 bytes, strict
UTF-8 and JSON. No URL, credentials, clock, timeout or freshness override flags.
The CLI reads two local files and writes only the report JSON to stdout.
It performs no HTTP request, retry, file write or database access.

The pure API reportNarMaterialConditions(bundle, response, options) clones both
inputs, resolves one audit clock, then calls unchanged Phase140.17 acceptance.
Source hash, latest-attempt/manifest consistency, date, freshness, saved rows,
Pack hash, affected-race diagnostics and condition counters must all pass the
existing gates. A prebuilt accepted object does not bypass them.
CURRENT remains the default. Explicit HISTORICAL mode permits only an otherwise
valid stale source; original sourceMirrorDecision=HOLD, SNAPSHOT_STALE,
capturedAt and actual auditedAt stay visible. Hash mismatches, future captures,
failed latest attempts and unsupported input still HOLD.

CONDITION_REPORT_READY or HISTORICAL_CONDITION_REPORT_READY means a consistent
local evidence projection. The bundle commit remains declared, and diagnostic
provenance is DECLARED_LOCAL_JSON_NOT_AUTHENTICATED. The report performs no
transport verification and does not inherit one from caller-supplied fields.
Source payload SHA-256 and the acceptance JSON.stringify response SHA-256 are
retained. Neither authenticates a signature or proves live diagnostic freshness.

## Report contents

- Race, horse and retained episode indices identify accepted observations.
- Active missing TIME rows retain the validated source observation, predicate
  observation, target distance, retained/parsed run counts, coverage flag and
  finite/exact/within-300m/invalid-distance/nonpositive-time counters.
- History rows retain validated origin (NAR/JRA/OTHER/UNAVAILABLE), source HOLD
  reason, date/venue flags, match counters and retained condition observation.
- Totals count active missing TIME horses and held History references in the
  accepted diagnostic races only. Origin totals and origin/observation groups
  reconcile to that same reference population. They do not count all careers,
  all missing material or all expected meeting races.
- Retained coverage complete/incomplete counts describe retained TIME input
  only, never full career coverage. A valid observed zero is emitted only after
  acceptance; HOLD and NO_DIAGNOSTIC_TASKS have totals=null, not invented zeros.
- Remaining plan tasks retain their separate observed counters and required
  evidence/input with status=UNRESOLVED, including ability/Pack tasks that
  cannot be satisfied by status diagnostics. History link-held, store-held and
  store-unresolved counters have unknown overlap and are never added together.

Rows are ordered by race ID, horse number and episode index, not betting priority.
Raw body, horse names, arbitrary text and unvalidated properties are excluded.
The optional venueCodeComparison object is deliberately not projected because
Phase140.17 does not validate its internal contract. The report says
venueCodeComparison=NOT_EVALUATED and makes no venue-code repair conclusion.

NO_DIAGNOSTIC_TASKS does not establish that all investigation work is complete;
ability/Pack review tasks may remain. CLI exit 0 indicates a ready report or no
diagnostic tasks; exit 1 indicates HOLD. No causal diagnosis, task completion,
History linkage, TIME estimate, DATA/Pack rewrite, odds or predictive signal is
created. Preserve Original EARLY Signal Freeze, marks and diamonds/warnings.
Probability MODEL_HOLD, formalKpiEligible=false, acquisitionCertified=false,
currentStatusEligible=false, diagnosisStatus=NOT_ESTABLISHED,
taskCompletion=NOT_CLAIMED and Production Activation NO-GO remain fixed.
October 18 code-22 production acquisition is a separate pending check.

## Verification

New tests: 21 PASS. Existing related tests: 166 PASS; combined 187 PASS.
Fixtures use the existing real diagnostic generator, compact projector and
acceptance, plus explicit synthetic boundary variants. The four-origin fixture
is synthetic, not an observed breakdown of the October 15 production response.
Tests cover origin/count reconciliation, inactive runners, incomplete retained
coverage, multiple races and affected-only scope, historical source retention,
raw-input revalidation, drift/malformed conditions, unknown overlapping counters,
unresolved tasks, no-task null totals, deterministic output, hash/provenance
limits, free-text containment and independent two-file CLI limits.

Full local npm run check: 2,176 tests / 2,174 PASS / 2 FAIL / skip 0.
Failures require unavailable local Chrome (jra-browser-smoke and
viewer-nar-ability-browser). The complete local suite is not PASS. The Bridge
must pass the entire suite before a merge GO. No new real diagnostic acquisition
or real origin breakdown was established by this phase's synthetic tests.
