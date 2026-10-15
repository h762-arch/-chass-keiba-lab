# Phase140.20: single-read diagnostic condition report

Base: 1d02eefdefdd25dda51baf97415bb5876b7950ac (merged PR #223).

## Purpose and invocation

Connect the existing bounded Phase140.18 public read to Phase140.19 reporting.
The original acceptance-only behavior remains the default. Opt into the report
with the new exact CLI flag --conditions:

```sh
node scripts/read-nar-material-diagnostics.mjs --bundle /absolute/path/bundle.json --date 2026-10-15 --conditions
node scripts/read-nar-material-diagnostics.mjs --bundle /absolute/path/bundle.json --date 2026-10-15 --historical --conditions
```

--historical and --conditions may occur in either order after the date. Duplicate
flags, flag values, arbitrary URLs, credentials, clock/deadline/freshness overrides
and unknown arguments are rejected before any request. Bundle fields and injected
CLI test options cannot silently enable either flag. The local bundle remains
limited to a regular file, 1 MB, strict UTF-8 and valid JSON.

The pure/configurable reader API adds includeConditionReport=false. A nonboolean
value fails closed before GET. Existing callers and ordinary CLI invocations
retain INSPECTION_READY/HISTORICAL_INSPECTION_READY and no conditionReport field.

## One response, separate audit layers

When requested, the reader passes its pinned pre-await bundle and the exact
decoded bounded response to the unchanged condition report function. No second
GET, response clone stream, raw-response file, alternate endpoint, retry or
caller-provided accepted object is used. The report recomputes acceptance from
both raw inputs using the same validated completion clock as the reader's
acceptance. The existing source gate, manual redirect policy, omitted credentials,
8-second default fetch/body deadline, 1 MB streaming bound and strict UTF-8/JSON
checks remain unchanged. The deadline bounds transport, not synchronous CPU work.

With the flag, top-level status is CONDITION_REPORT_READY or
HISTORICAL_CONDITION_REPORT_READY, with nested acceptance and conditionReport.
Their separate scopes and decisions remain visible. A successful HTTP read is
not sufficient for a ready report. Drift, failed acceptance or transport errors
produce HOLD and conditionReport=null, never fabricated counts. If reporting
itself HOLDs after acceptance, the top-level result also HOLDs.

No diagnostic tasks means NO_DIAGNOSTIC_TASKS and zero requests. The requested
report has totals=null and retains unresolved ability/Pack tasks when present;
it does not certify complete material or acquisition. CLI exit 0 includes ready
reports and no diagnostic tasks; HOLD exits 1. Only sanitized JSON is written to
stdout; the tool does not persist the raw body or write source data.

readAudit.transportBasis=FIXED_PUBLIC_ENDPOINT_GET describes the transport layer.
Its responseBytesSha256 hashes received body bytes. The report retains its own
JSON.stringify response hash, DECLARED_LOCAL_JSON_NOT_AUTHENTICATED provenance
and transportVerification=NOT_PERFORMED_BY_THIS_REPORT. These describe different
layers, not contradictory transport results or a cryptographic origin signature.
Pretty-printed response bytes may have a different hash from the report JSON.
Bundle commit provenance remains declared and requires independent retrieval.

Historical mode preserves source HOLD/SNAPSHOT_STALE, original capture timestamp
and actual audit timestamp. Completion past 30 minutes in CURRENT mode still
HOLDs. No source freshness promotion or current-status eligibility is introduced.
No automatic diagnosis, task completion, History/TIME repair, DATA/Pack rewrite,
marks, diamonds/warnings or Original EARLY Signal Freeze changes.
Probability MODEL_HOLD, formalKpiEligible=false, acquisitionCertified=false,
currentStatusEligible=false, diagnosisStatus=NOT_ESTABLISHED,
taskCompletion=NOT_CLAIMED and Production Activation NO-GO remain fixed.
October 18 code-22 production acquisition remains a separate pending check.

## Verification

New integration tests: 20 PASS. Existing related tests: 187 PASS; combined 207 PASS.
Fixtures use the existing real generator, compact projector, acceptance and
condition report. Coverage includes one fixed request, exact report reproduction,
default compatibility, explicit flags/configuration, no-request gates, stale
historical usage, completion-time freshness crossing, shared completion timestamp,
invalid input/conditions, timeout and late response, drift, async source pinning,
byte-vs-JSON hash bases, private-field containment, immutable input and fixed gates.
Full local npm run check: 2,196 tests / 2,194 PASS / 2 FAIL / skip 0.
The two failures require missing local Chrome (jra-browser-smoke and
viewer-nar-ability-browser). Full local regression is not PASS; Bridge must pass
the entire suite before merge GO. No production workflow was edited or run here.

## One confirmed real historical read

The CLI was run once with --historical --conditions against an unmodified bundle
retrieved from fixed chass-data commit bcd7e08c07d8b271869f120ce3df574e653bdf0d.
Attempt, manifest and snapshot were read from that same commit. Snapshot date:
2026-10-15; capturedAt=2026-10-15T13:35:54.892Z; payloadSha256=
3117cb528be5b5139a59613f05e91dd4efcbd69f1a2a1bcd3dad6239db2cc23e.

Actual fixed public GET:
- attemptedAt=2026-10-15T21:55:15.237Z (October 16, 06:55 JST).
- finishedAt=2026-10-15T21:55:23.058Z; requestCount=1; responseBytes=50381.
- responseBytesSha256=9d9becc433aeacf1dd8d1260a1faee50dc712bbc236198551d0caec40fa127f4.
- All twelve saved rows matched; seven affected races were accepted and reported.
- Top-level status HISTORICAL_CONDITION_REPORT_READY; source decision remains
  HOLD / STALE / SNAPSHOT_STALE. This is not current October 16 coverage.

Validated retained-condition counts:
- Active missing TIME: 9 horses, all NO_FINITE_TIME_WITHIN_300M, with retained
  coverageComplete=true. This does not prove full career coverage.
- Held History references: 32 = 30 JRA + 2 NAR; OTHER=0, UNAVAILABLE=0 within this
  accepted reference population. The thirty JRA references have ORIGIN_NOT_NAR.
- The two NAR references have NO_VENUE_MATCH: race 20261015-NAR-21-03, horseNo=9,
  episodeIndex=3 and 4. Venue code comparisons remain NOT_EVALUATED.

The origin detail is newly observed from validated retained response fields;
the earlier sanitized ORIGIN_NOT_NAR aggregate alone could not establish it.
It does not establish a root cause, identity correction, safe exclusion policy,
future availability or production code-22/23 acquisition success. All original
HOLDs and unresolved tasks remain. No new collection or automatic repair follows.
