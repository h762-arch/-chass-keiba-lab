# Phase140.14: read-only saved-race material coverage report

Base: 70a4e4727b1a5db7616e714377889881eaa7c025 (merged PR #217).

## Purpose

Continue material-quality work independently of the October 18 code-22 trial.
Project captured status counts into a race-by-race list of observed shortages
and unknown counters. No Worker, D1, collector, schedule, installed workflow,
model, TIME predicate, History identity, saved DATA or Signal changes.

The bundle-only CLI accepts exactly:

```sh
node scripts/report-nar-status-coverage.mjs --bundle /absolute/path/bundle.json --date 2026-10-15
```

The bundle contains commitSha, attempt, snapshot and manifest, as in Phase140.13.
Resolve chass-data independently and read all three files at that same SHA.
The tool first calls the existing mirror audit with its default 30-minute age
policy and the actual audit clock. Any HOLD returns no rows and null totals.
Bundle fields cannot override date, age, clock, provenance or governance.
Input is bounded to 1 MB. It performs no network requests or file writes;
stdout is the only report output. Exit 0 means OBSERVED, exit 1 means HOLD.

## Meaning and limits

- The commit provenance is DECLARED_LOCAL_BUNDLE. The local file alone does not
  prove which commit supplied its JSON; preserve connected-reader evidence.
- Rows are SAVED_RACES_ONLY, not coverage against all expected races at a meeting.
- Active ability/TIME shortages use quality schema 1 active counts, not the
  all-runner denominator. Cancelled runners must not inflate active shortages.
- Missing or unsupported quality gives null active counts. Invalid supplied
  counts, duplicate race IDs, identity or venue mismatches fail closed.
- Race identity uses the corrected code/name mapping (22 金沢, 23 笠松).
- Absent optional all-runner counts do not invent an observed zero.
- History link-held references, store-held episodes and unresolved observations
  are separate counters. Their overlap is UNKNOWN: never add them together.
- Counter totals become null if any race lacks that counter; knownSubtotal and
  unknownRaceCount preserve the available evidence without filling missing data.
- PARTIAL is only the status response's Pack label with a structurally valid
  hash string. This report does not fetch or verify the full Analysis Pack.
  A missing/invalid label/hash is UNAVAILABLE; legacy NOT_MATERIALIZED stays distinct.
- Review reasons identify observed gaps or unknowns, not causal diagnoses,
  permanent horse identities, career completeness, predictive accuracy or a
  calibrated model. An empty review list is not a formal-readiness certificate.
- No horse-level missing identity, exact missing TIME cause, race acquisition
  completeness, odds, EV, marks or diamonds/warnings can be inferred here.

Every successful report keeps formalReadiness=NOT_EVALUATED,
Probability MODEL_HOLD and Production Activation NO-GO. Even a fresh, internally
consistent mirror is not proof of live code-22/23 acquisition.

## Verification

New tests: 18 PASS. Related mirror-audit tests: 25 PASS (43 combined).
Full npm run check: 2079 tests, 2077 PASS, 2 FAIL, no skips. The two failures
require local Chrome (jra-browser-smoke and viewer-nar-ability-browser).
The local complete check is not PASS; Bridge must pass both browser tests.
Cases include active/inactive denominators, unknown counts, separate overlapping
History counters, stale/tampered packages, date/venue/duplicate rows, contradictory
counts, legacy Pack labels, immutable input, deterministic order, empty saved
sets, exception-text containment and CLI input/size/UTF-8 rejection.

Real connected-GitHub bundle at bcd7e08c07d8b271869f120ce3df574e653bdf0d:
capture 2026-10-15T13:35:54.892Z. Report audit at
2026-10-15T13:56:48.358Z.
The observed twelve saved races contain 141 active runners, 0 active ability
shortages, 9 active TIME shortages, 32 link-held references, 0 store-held episodes,
and 32 unresolved observations. These two 32 counters must not be summed.
Seven races have at least one observed shortage/unknown review condition:
3, 7, 8, 9, 10, 11 and 12. All Pack status labels remain PARTIAL.

These describe that capture and audit time, not a subsequent refresh. Historical
reports must retain their original auditedAt; never relabel stale inputs as fresh.
The October 18 acquisition verification remains a separate pending task.

Bridge full regression and independent diff review are required before merge GO.
