# Phase140.17: diagnostic JSON consistency acceptance

Base: e17c9fa8d00437e389825741eae3a62705aec427 (merged PR #220).

## Input and purpose

Phase140.16 describes response acceptance requirements without implementing a
reader. This patch adds a pure acceptance function and two-file, offline CLI.
It revalidates the original raw bundle and rebuilds the investigation plan.
A prebuilt report/plan cannot bypass date, integrity, freshness or row gates.

```sh
node scripts/accept-nar-material-diagnostics.mjs --bundle /absolute/path/bundle.json --diagnostics /absolute/path/diagnostics.json --date 2026-10-15
node scripts/accept-nar-material-diagnostics.mjs --bundle /absolute/path/bundle.json --diagnostics /absolute/path/diagnostics.json --date 2026-10-15 --historical
```

The diagnostics file must contain the existing unfiltered date response with
format=compact and diagnostics=1. Each file is independently limited to 1 MB;
invalid UTF-8, malformed JSON, missing files and unsupported flags HOLD.
The CLI has no URL, credentials, fetch, write, clock or max-age override flag.
CURRENT remains the default. HISTORICAL is explicit and retains source stale
HOLD/reasons and original capturedAt with the real new audit time.

## Response binding

Require matching date, research governance, both schemas ready, DATE count scope,
ALL_RESTORED_RACES scope and no selected race. The entire saved-race set must
match the original capture, independent of race-row order. All recorded fields
are compared, including count, quality, History counters and Pack hash strings.
Extra/missing/duplicate rows, a changed Pack hash or even other saved-row field
drift HOLD. Top-level current schedule flags need not equal a historical capture.

The sidecar must be schema 1 with AFFECTED_HORSES detail scope, one unique entry
for every saved race, and a consistent aggregate OBSERVED/PARTIAL label.
Only planned diagnostic races are projected. Each affected race must itself
be OBSERVED with matching horse/active/TIME/held-reference totals and research
flags. PARTIAL/UNAVAILABLE affected diagnostics remain HOLD, never zero-fill.

Horse IDs must be unique and bounded, active flags boolean, displayed/omitted
counts consistent, and missing active TIME/held History totals reproducible from
the displayed horses. Unaffected horses must remain omitted by the compact
contract. Unknown source reasons and inconsistent reason dictionaries HOLD.

For active missing TIME, require available retained conditions. Check bounded
candidate counts, exact/within-300m subset relations, coverage fields and the
existing condition observation predicate without computing a predicted time.
For held History, check bounded unique episode indices, origins, flags,
reference-count relations, eligible-candidate predicate, observation category
and agreement with per-horse/race reason counts. No episode identity is repaired.
Only bounded horse IDs and recognized categorical condition summaries leave
the acceptance function. Names, raw URLs, raw facts and free text are not copied.

## What acceptance does not establish

INSPECTION_READY or HISTORICAL_INSPECTION_READY means internally consistent
declared local diagnostic content is ready for inspection. It is not a live
fetch certificate, authenticated origin, full Pack verification, parent DATA
hash verification, complete career History or causal diagnosis. Comparing a
Pack hash string is not recomputing the Pack. The response SHA-256 identifies
the supplied JSON.stringify content; it is not an independent trusted signature.

diagnosticProvenance=DECLARED_LOCAL_JSON_NOT_AUTHENTICATED,
currentStatusEligible=false, acquisitionCertified=false,
diagnosisStatus=NOT_ESTABLISHED and taskCompletion=NOT_CLAIMED always remain.
Accepted observations do not fulfill separate ability, Pack or rolling-store
evidence requirements. Formal readiness stays NOT_EVALUATED. A partial/unavailable
diagnostic packet requires separate inspection, not relaxation of these gates.

When no diagnostic task exists, the pure function returns NO_DIAGNOSTIC_TASKS
with no accepted observations; that is not response validation success.
The CLI still requires its two readable JSON files. Exit 0 means inspection
output or no applicable diagnostic task, not execution, freshness or model GO.

## Scope and verification

Only this document, a new pure module, CLI and tests are added. No Worker, D1,
collector, installed workflow, schedule, model, TIME/History facts, saved Pack,
EARLY Signal, marks or diamonds/warnings are changed. The October 18 code-22
production acquisition check remains separately pending. Probability MODEL_HOLD,
formalKpiEligible=false, Production Activation NO-GO.

New tests: 21 PASS; existing related suites: 77 PASS; combined 98 PASS.
The success fixture uses the actual existing diagnoseNarRestoredRaceBatch and
compactNarPrecomputeStatus functions over synthetic retained facts. Other cases
cover row/hash/count drift, wrong scope/date/governance, missing/duplicate races
and horses, omitted details, unavailable/contradictory TIME/History conditions,
source revalidation, explicit historical mode, immutable input, free-text
containment and independent local file/UTF-8/size limits.
Full npm run check: 2134 tests / 2132 PASS / 2 FAIL / skip 0. Both failures
require Chrome (jra-browser-smoke and viewer-nar-ability-browser). Bridge must
pass all tests before merge GO; the complete local check is not PASS.

No real diagnostic response was available for acceptance during preparation.
Passing a previously verified real historical status bundle with null diagnostics
returns HOLD/RESPONSE_CONTRACT_INVALID with no observations. This is only a
missing-input check, not a successful real-data diagnostic acceptance or E2E.
No new HTTP probe, source capture or completed investigation is claimed.
