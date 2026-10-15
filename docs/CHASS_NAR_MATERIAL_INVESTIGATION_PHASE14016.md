# Phase140.16: saved-material investigation plan

Base: c0c7ae9128a1ce83f5dbd41b6da8240bfb6ab596 (merged PR #219).

## Purpose

Turn observed saved-race shortages into concrete evidence-review tasks. Start
from a raw Phase140.13 bundle, re-run Phase140.14/15 coverage validation, and
preserve CURRENT versus explicitly selected HISTORICAL mode. A supplied report,
request URL or task list is never trusted as an input substitute.

```sh
node scripts/plan-nar-material-investigation.mjs --bundle /absolute/path/bundle.json --date 2026-10-15
node scripts/plan-nar-material-investigation.mjs --bundle /absolute/path/bundle.json --date 2026-10-15 --historical
```

The first command retains the normal 30-minute HOLD. The second can produce a
HISTORICAL_PLAN_READY only through the existing explicit historical gate.
Source freshness, mirror HOLD/reasons, original capturedAt, actual auditedAt,
declared commit and payload hash stay visible. Bundle fields cannot override
mode, date, clock or freshness threshold. CLI input is bounded to 1 MB.
Exit 0 means a plan was produced, not that a request ran or evidence was obtained.

## Task mapping

- Missing/unknown active ability: review separately verified saved DATA or Pack
  for runner identities, retained evidence and the source missing-score reason.
- Missing/unknown active TIME: inspect saved-status diagnostics for active-runner
  coverage, original missing reason, retained candidate times and history coverage.
- Positive or unknown History counters: inspect retained held-reference reasons
  and match conditions; inspect the separate rolling-store audit when these do
  not explain a store counter. The three History counters are never summed.
- Missing/unsupported Pack label: inspect separately verified parent DATA/Pack,
  retaining explicit NOT_MATERIALIZED where appropriate.

Tasks contain diagnosisStatus=NOT_ESTABLISHED. A shortage is not a proven cause.
No task recomputes TIME, infers an episode year, repairs an identity or alters
Original Signal. No-task races are not certified as full-history/model ready.
Rows are ordered by race ID, not a claimed predictive or financial priority.

## Read request plan, not a fetcher

When TIME/History inspection is required, emit one fixed-origin GET plan:
the existing nar-precompute-status endpoint with the validated date,
format=compact and diagnostics=1. No race filter is used. The endpoint restores
and diagnoses the date set before projection; repeated per-race requests would
repeat that work. An unfiltered request also avoids the endpoint's documented
AMBIGUOUS_RACE behavior when venues share a race number.

The request lists expected race IDs and response acceptance requirements:
verify date/identity, compare captured counts and the recorded Pack hash where
present, validate diagnostic schema/detail scope, and HOLD on drift/unavailability.
These are requirements for a future reader, not an implemented response validator.
sourcePackHash is only the captured hash string; this planner does not verify the
full Pack. A later response is a separate read, not the original capture. Preserve
the original reference and investigate changes instead of silently replacing it.

Ability/Pack-only tasks emit no diagnostic request, since that sidecar does not
contain their full saved facts. Store counters may also require saved DATA.
There is no automatic fetch, retry, background job or URL supplied by the bundle.
executionStatus stays NOT_EXECUTED and automaticExecutionAllowed=false.

## Scope and limits

Only a pure module, bundle-only CLI, tests and this document are added. No Worker,
D1, runtime flags, collector, installed workflow, schedule, saved DATA, model,
TIME predicate, History mapping, Pack or EARLY Signal changes. The October 18
code-22 acquisition check remains separately pending. Probability MODEL_HOLD,
formalKpiEligible=false, acquisitionCertified=false, Production Activation NO-GO.
Commit origin stays DECLARED_LOCAL_BUNDLE, not a signed provenance assertion.

During preparation, one direct HTTP diagnostic probe for October 15 race 3 timed
out after ten seconds with no response bytes. This does not establish an API
outage, a parser defect or any missing-evidence cause. Direct diagnostic E2E
success remains unverified. The distributed plan does not execute that request.

## Validation and historical example

New tests: 18 PASS. Existing related tests: 59 PASS. Combined: 77 PASS.
Full npm run check: 2113 tests / 2111 PASS / 2 FAIL / skip 0. Both failures
require local Chrome (jra-browser-smoke and viewer-nar-ability-browser).
Bridge must pass the full regression before merge GO.
Cases cover task selection, unknown neutrality, separate History counters,
single-read planning, multi-venue race-number ambiguity, separate DATA/Pack
requirements, stale/default HOLD, historical mode, raw-bundle revalidation,
immutability, deterministic order, injected URL/report rejection and CLI bounds.

Real saved bundle: bcd7e08c07d8b271869f120ce3df574e653bdf0d,
capturedAt=2026-10-15T13:35:54.892Z; inspected at
2026-10-15T14:41:30.575Z. HISTORICAL_PLAN_READY; source freshness STALE,
source mirror HOLD/SNAPSHOT_STALE. Twelve saved races produce seven affected
races (3, 7, 8, 9, 10, 11, 12), four TIME tasks and five History tasks, nine total.
One unexecuted date diagnostic request is planned. These are historical saved
observations, not a new source capture or completion of the nine investigations.
