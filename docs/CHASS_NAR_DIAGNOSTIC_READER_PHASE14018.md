# Phase140.18: bounded public diagnostic reader and acceptance

Base: ac7638332125be13bafd0a5731ba1320baccc775 (merged PR #221).

## Purpose and invocation

Execute the single read described by Phase140.16, then pass the decoded JSON to
the unchanged Phase140.17 consistency acceptance function. This is a standalone
Node tool, not a Worker route, background job or installed workflow change.

```sh
node scripts/read-nar-material-diagnostics.mjs --bundle /absolute/path/bundle.json --date 2026-10-15
node scripts/read-nar-material-diagnostics.mjs --bundle /absolute/path/bundle.json --date 2026-10-15 --historical
```

The local bundle is limited to 1 MB. Only these exact CLI arguments are accepted.
There are no arbitrary URL, credential, timeout, clock or max-age flags.
The CLI derives explicit CURRENT/HISTORICAL mode from its arguments, never from
bundle fields. Raw input is not modified and the source bundle is cloned before
awaiting IO, so a caller cannot replace the validated source during the request.

## Source gate and fixed public read

Rebuild the investigation plan at the actual pre-read clock. Invalid or stale
CURRENT input stops before network; an explicitly historical source retains all
existing integrity/freshness and governance gates. No diagnostic tasks means
NO_DIAGNOSTIC_TASKS with requestCount=0, not a successful fetch certificate.

When a read is required, make one GET call to the existing fixed public status
endpoint using the validated date, format=compact and diagnostics=1. Do not use
a URL in bundle data or follow redirects. Send only accept:application/json;
credentials are omitted. There is no retry or fallback path.

Require HTTP 200, no redirected response, application/json and a readable body.
Reject content-length over 1 MB and independently bound streamed bytes to 1 MB.
Decode UTF-8 strictly before parsing JSON. Default timeout is 8 seconds across
fetch and streamed body reads. A pure-call test/configuration port permits 1 to
15000 ms; the CLI does not expose it. This is a transport deadline, not a strict
CPU execution deadline for subsequent bounded pure acceptance computation.
Abort/cancel on completion, timeout or error. A late response is discarded and
cannot yield acceptance. Exception text and unvalidated raw body are not copied.

At read completion, validate a finite nondecreasing clock and re-run acceptance
at that completion time, not the pre-read clock. A capture crossing the default
30-minute freshness boundary during the GET therefore remains HOLD.

## Output and limits

readAudit distinguishes NOT_ATTEMPTED, NOT_REQUIRED, FAILED and CAPTURED.
CAPTURED means the bounded HTTP/JSON read completed; inspect top-level status
and nested acceptance separately. A changed saved row or Pack hash still HOLDs
even when HTTP reading succeeds. Audit includes request count, fixed source URL,
attempt/finish timestamps, byte count and SHA-256 over received decoded body bytes.
The nested acceptance also retains its own JSON.stringify hash when successful.

Only the sanitized Phase140.17 observations are emitted, not raw response JSON.
transportBasis=FIXED_PUBLIC_ENDPOINT_GET records this tool's read path; the
nested pure acceptance keeps DECLARED_LOCAL_JSON_NOT_AUTHENTICATED. These are
different layers, not a cryptographic origin signature. Source bundle commit
provenance remains declared and independently retrieved by the caller.

INSPECTION_READY/HISTORICAL_INSPECTION_READY is not a causal diagnosis, formal
prediction, source freshness promotion or production activation. Historical
source HOLD/SNAPSHOT_STALE remains visible. currentStatusEligible=false,
acquisitionCertified=false, diagnosisStatus=NOT_ESTABLISHED,
taskCompletion=NOT_CLAIMED and formal/model gates remain unchanged.
CLI exit 0 means inspection output or no applicable diagnostic tasks; exit 1
means HOLD. HTTP failure yields no fabricated acceptance or zero coverage.

No production writes, D1 migration, collector/schedule/flag changes, new Workflow,
TIME/History repair, DATA/Pack rewrite, EARLY Signal, marks or diamonds/warnings.
October 18 code-22 production acquisition stays a separate pending check.
Probability MODEL_HOLD, formalKpiEligible=false, Production Activation NO-GO.

## Verification

New tests: 21 PASS. Existing related suites: 98 PASS; combined 119 PASS.
Fixtures use the real diagnostic generator, compact projector and acceptance.
Tests cover the fixed unauthenticated GET, zero-request gates, stale historical
mode, completion freshness crossing, configuration/clock validation, HTTP errors,
redirects, content types, JSON/UTF-8/byte bounds, unresponsive fetch/body timeout,
late response cancellation, accepted-row drift, async source pinning, immutable
input, exception/body containment and CLI input boundaries.
Full npm run check: 2155 tests / 2153 PASS / 2 FAIL / skip 0. Both failures
require local Chrome (jra-browser-smoke and viewer-nar-ability-browser).
The complete local check is not PASS; Bridge must pass all tests before merge GO.

## One confirmed real read, not an availability guarantee

On 2026-10-16 JST the historical CLI fetched and accepted the October 15 saved
status diagnostics once. attemptedAt=2026-10-15T15:18:36.729Z,
finishedAt=2026-10-15T15:18:44.206Z (00:18 JST), bytes=50381,
responseBytesSha256=9d9becc433aeacf1dd8d1260a1faee50dc712bbc236198551d0caec40fa127f4.
Source bundle data commit bcd7e08c07d8b271869f120ce3df574e653bdf0d,
capturedAt=2026-10-15T13:35:54.892Z. All twelve saved row summaries matched;
seven planned diagnostic races were accepted as HISTORICAL_INSPECTION_READY.
Source mirror decision remains HOLD/SNAPSHOT_STALE. This verifies this single
direct-reader-to-acceptance path, not continued availability or code-22/23 racing.

Sanitized retained-condition observations:
- Nine active missing TIME runners: NO_FINITE_TIME_WITHIN_300M, with retained
  coverageComplete=true. This covers the retained material, not full careers.
- Thirty held History references: ORIGIN_NOT_NAR. The sanitized projection does
  not distinguish JRA, other or unavailable origins; do not infer all thirty are JRA.
- Two held references: NO_VENUE_MATCH, both for 20261015-NAR-21-03 horseNo 9.
  This is an observed retained matching condition, not a proven venue-code bug.

The 32 History references are 30+2, not 32 ORIGIN_NOT_NAR. Their original HOLDs
are preserved. No diagnosis, identity repair or new prediction was performed.
