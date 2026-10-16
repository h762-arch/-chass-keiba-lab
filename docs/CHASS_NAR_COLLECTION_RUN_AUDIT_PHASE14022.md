# Phase140.22: distinguish mirror publication from recorded collection progress

Base: 2f53eac5166b1fa9c8291f278272bc8b083566ef (merged PR #225).

## Problem and invocation

The October 16 scheduled snapshot was captured and published successfully, while
its latest NAR run recorded COMPLETED, attempted=0, saved=0, and three meeting
source HTTP 404 responses. A fresh integrity-verified mirror and a COMPLETED run
status do not establish successful collection. This standalone read-only audit
keeps those conclusions separate and exposes a reasoned collection HOLD.

```sh
node scripts/audit-nar-collection-run.mjs --bundle /absolute/path/bundle.json --date 2026-10-16
```

The new pure module, local CLI, tests and this document are the only four files.
No production runtime, scheduler, routing, HTTP behavior, schema, D1, workflow,
collection conditions, limits, model, DATA/Pack or EARLY frozen signals change.
The CLI reads one regular file of at most 1 MB, validates UTF-8 and JSON, and
writes sanitized JSON to stdout. No network request, raw HTML, database access,
file write or collector execution occurs. URL, token, historical and clock flags
are not accepted. Source bundle metadata is declared, not origin-authenticated.

## Source and recorded-run gates

First re-run unchanged Phase140.13 mirror integrity/readiness/freshness checks on
the raw bundle at the actual audit time. Only VERIFIED sources proceed; stale,
future, failed-latest, mismatched-date or hash-inconsistent sources HOLD. A
prebuilt VERIFIED object cannot substitute for the original attempt, manifest
and snapshot. Historical mode and max-age extension are not introduced.

Require a RECORDED narRunAudit with canonical timestamp, matching target/JST
date and scheduledAt no later than capturedAt. The public lastNar aliases must
exactly match that same recorded audit. Counters are required integers, not
string/null/negative defaults; saved cannot exceed attempted or the captured
date's savedRaceCount. autoResultProcessed is retained separately, not added to
NAR saves. The producer already normalizes some missing original scheduler
values to zero: this tool audits the recorded representation and cannot recover
those original missing values or certify successful acquisition from them.

A fresh snapshot can contain an old run, so also HOLD if the recorded run is
older than 30 minutes at audit time (exactly 30 minutes is included). Preserve
the distinct mirror verdict and the observed run age. No run or unavailable
audit yields run=null, not zero attempts/saves invented by this tool.

Validate at most 64 retained events, known date/venue race identities, and up to
three ordered official meeting route attempts. Route names, source reason codes
and integer HTTP status codes are checked and projected without URLs, HTML,
body, arbitrary names or exception text. Unknown event/run reason text is
represented as UNRECOGNIZED_RECORDED_REASON and requires review; it is neither
silently dropped nor repeated. The event scope is the latest retained record,
not a complete run/day history; a producer may already have capped the list.

## Classification, not activation

- Meeting source failure always yields collection HOLD, even if runStatus is
  COMPLETED or another track saved something. Keep recorded nonzero saves when
  present; do not replace them with zeros or describe the whole run as success.
- Not-completed run status, top-level reason, unknown/review event, attempted
  without save, and an attempted/saved gap require review and HOLD.
- Zero attempts with no event explanation HOLD. Explicit retained NON_MEETING or
  ALREADY_SAVED events can be OBSERVED/NO_ATTEMPT_RECORDED; they do not certify
  that this tool independently verified non-meeting or existing stored DATA.
- A completed internally consistent save record can be OBSERVED/SAVE_RECORDED.
  That is only the recorded count, not independent save/hash verification,
  full meeting coverage or activation. Original counters/status remain visible.

mirrorAudit.status can therefore remain VERIFIED while top-level status=HOLD.
collectionOutcome describes recorded counts separately from the status and
reasons. OBSERVED is never an activation GO. CLI exits 0 for OBSERVED and 1 for
HOLD, including an accurately observed source failure. No automatic retries,
repair, source rerouting, identity rewrite, TIME generation or signal changes.
Probability MODEL_HOLD, formalKpiEligible=false, acquisitionCertified=false,
currentStatusEligible=false, diagnosisStatus=NOT_ESTABLISHED and Production
Activation NO-GO remain fixed. October 18 code-22 acquisition stays separate.

## Confirmed operational evidence, October 16 JST

Scheduled workflow (event=schedule) completed successfully:
https://github.com/h762-arch/-chass-keiba-lab/actions/runs/38831851469
Its log records CAPTURED and publication of data commit
25a2a417d321cec24c752ed88714caf6a10e924b. Attempt, manifest and snapshot were
retrieved from that same fixed commit. capturedAt=2026-10-16T00:51:24.947Z,
payloadSha256=b7d43ed1a65268a442e15fd400094179c36b96ecda9d4d062b972e9d7b32641d.
At the recorded audit time, mirror integrity/freshness was VERIFIED; this proves
this scheduled publication, not every scheduled execution or collection success.

The new CLI returned HOLD with MEETING_SOURCE_UNAVAILABLE and
NO_ACQUISITION_ATTEMPT_RECORDED while mirrorAudit stayed VERIFIED. Saved/rejected
rows: 0/0. Latest recorded run: scheduledAt=2026-10-16T00:50:18.556Z,
runStatus=COMPLETED, attempted=0, saved=0, autoResultProcessed=0. Its Kawasaki
RaceList, RaceList_ipat and RaceList_mobile attempts each record SOURCE_HTTP/404.
The stored response flags and collection conditions are unchanged.

An independent web retrieval of the official NAR October 16 Kawasaki menu
displayed 12 scheduled races, so the 404 record must not be interpreted as
proof of a non-meeting:
https://www.keiba.go.jp/KeibaWeb/TodayRaceInfo/RaceList?k_babaCode=21&k_raceDate=2026%2F10%2F16
This retrieval uses a different path/environment and is not a successful
production collector E2E. A single local call to the unchanged meeting reader
at 2026-10-16T00:56:39.502Z ended 00:56:44.504Z with SOURCE_DEADLINE on all three
routes. The cause of differences between retrieval paths remains unestablished;
no endpoint, header, routing or timeout change is justified by that alone.

The historical October 15 condition GET was separately attempted once under
merged Phase140.21, from 2026-10-16T00:54:50.721Z to 00:54:58.737Z. It returned
READ_TIMEOUT with requestCount=1, conditionReport=null. The two actual venue
comparisons remain unconfirmed; this new collection audit does not resolve them.

## Verification

New tests: 22 PASS. Existing related tests: 136 PASS; combined 158 PASS.
Tests use the actual run normalizer/public-field projector and raw mirror bundle
hashes. They cover completed-but-unavailable source, known save/no-attempt
records, unknown zeros, partial saves, fresh mirror/stale run, exact age bound,
date/clock/count/alias/event/route validation, safe unknown text, immutable inputs,
raw-bundle revalidation, separate model gates and bounded local CLI input.

Full local npm run check: 2,239 tests / 2,237 PASS / 2 FAIL / skip 0. Failures
require unavailable local Chrome (jra-browser-smoke and viewer-nar-ability-browser).
The complete local suite is not PASS. Bridge must pass all tests before merge GO.
The real CLI's collection HOLD is the expected factual outcome, not a failing
implementation test or a fabricated collection success.
