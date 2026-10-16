# Phase140.29: unchanged production meeting-reader control in the diagnostic host

Base: 505a887e55ad350a464e658462899dd40c5d2b7e (merged PR #232).

## Established milestone and next question

GitHub run38852121951 / attempt1 on this exact SHA observed candidate
meeting-to-card success at 2026-10-16T04:44:07.041Z..04:44:08.743Z (13:44 JST).
Both GETs returned HTTP200. Kawasaki races1..12 and selected race1 matched;
one unquoted anchor passed, zero quoted links passed. Meeting HTML fingerprint
was identical to the prior run38850831031's rejected capture. Card parsing
identified12 active runners with finite ability values and11 nonempty TIME
fields. No independent direct card was needed; two GETs total.

Artifact12025169236 ZIP SHA256 was independently verified:
ee673b7e0a967a435944bcdd8581fbb901837b20edd03cb8babb5971b01c8e9e.
Report SHA256 matched its digest and exact stdout bytes:
cbdcd981edb164417cfc592257d62922b816e34e8f9670573c1129e36bb645a5.
This establishes standalone candidate success, not Worker acquisition or D1.

The production meeting helper is a distinct existing path:
fetchNarPrecomputeMeeting uses encodeURIComponent date slashes and tries PC,
IPAT then mobile with a shared default5000ms transport budget. Its unchanged
meeting parsers decide meeting/non-meeting; it does not use the research
selected-link gate fixed in Phase140.28. Thus the research fix alone cannot
explain the earlier recorded Worker404 observations or prove recovery.

## Four-file change and activation

Add a research control module, update only the diagnostic CLI composition,
extend its existing tests and add this document. No production helper/parser,
runtime, collector, D1, URL route, collection condition, budget, model, existing
workflow or template change. No History/DATA/Pack/TIME or Original EARLY repair.
The registered source-probe workflow already invokes this CLI; after merge,
the same main manual dispatch performs comparison with no new registration.
October18 code22 acquisition stays a separate pending trial.

The legacy exported runNarReadOnlySourceProbe API retains its exact original
request budget and candidate result. The new exported WithControl composition
first calls it unchanged. Only MEETING_TO_CARD_OBSERVED schedules the control.
An invalid/context/date/clock/candidate HOLD or direct-only result skips it:
productionMeetingControl=null and NOT_PERFORMED_CANDIDATE_NOT_OBSERVED.

On candidate success, call unchanged fetchNarPrecomputeMeeting exactly once
with the same date/code, total timeout5000 and a bounded observing fetch port.
No createNarAbilityPrecomputeRunner, env configuration, Worker invocation,
schema query, persistence, snapshot readback or secret port is exposed.
The wrapper forwards the helper's original fetch options without custom
headers, modified response bodies, retry logic or alternate routes. It permits
only the three exact official encoded URLs in their existing order. No link
URL from response HTML is followed. No production source change follows.

The existing helper's fallback policy is preserved, including stopping on a
valid non-meeting response. The control reports HOLD unless the existing parser
identifies the requested date/venue, a bounded unique race list and selected
race membership. A non-meeting/missing race is not a positive control result.

## Limits, timing and provenance

Candidate success uses2 GETs; the subsequent control makes1..3 GETs. Maximum5
GETs total; candidate failures retain the old maximum3 and no control. The
helper retains manual redirects, strict UTF-8, per-body1MB and its own shared
5-second transport budget. Like earlier tools, this does not bound synchronous
parser CPU or prove continued availability. No odds/results/card follow-up is
introduced by the control, which inspects only the production meeting reader.

Before each actual control request and at completion enforce finite,
nondecreasing current-JST-date time, no time earlier than candidate completion,
and strictly before the candidate post time. Date rollover, regression or post
boundary blocks subsequent actual GETs even if the unchanged helper internally
continues its error-handling loop. Late responses are cancelled and cannot
mutate returned evidence. Tests cover late first-route completion after a
successful second route.

Control request records contain only fixed URL/route, attempted/header times,
available HTTP status and bounded states/reasons. HEADERS_OBSERVED does not
claim full-body capture or successful parse. MEETING_PARSED identifies only
the selected successful route. Earlier attempts may retain partial evidence;
the helper does not return all previous failure reasons on later success.
There is no raw HTML, response-byte hash, horse name, prediction, arbitrary
exception text, external URL or secret environment output. The original
candidate fingerprints retain their decoded/re-encoded basis separately.

The top-level comparison retains the original candidate status and nested
report; candidateRequestCount separates its GETs from total requestCount.
After control, candidateFinishedAt preserves the earlier endpoint and top-level
finishedAt uses control completion, or null when valid completion time cannot
be recorded. Candidate-only reports retain their original timing.

BOTH_MEETING_PATHS_OBSERVED means candidate E2E and this host's production
helper meeting check both passed. CANDIDATE_ONLY_CONTROL_HOLD preserves the
candidate observation but leaves parity unresolved. The CLI now exits0 only
for BOTH_MEETING_PATHS_OBSERVED; other results exit1 with artifacts retained.
Red can therefore mean candidate success plus unavailable control, not a
regression of candidate success. Review the two branches separately.

Keep MODEL_HOLD, NO-GO, formalKpiEligible=false and acquisitionCertified=false.
executionBasis=STANDALONE_NOT_WORKER_REPLAY and workerReplay=NOT_PERFORMED
remain explicit. Comparing these sequential reads does not isolate URL
encoding causality, prove Worker-environment behavior, authenticate a production
run, establish a404 cause or demonstrate D1/readback success. Independently
audit the run SHA/attempt and artifact digest as before.

## Verification and real-read limit

New20 tests plus existing21 source-probe tests:41 PASS. Other related tests173
PASS; combined214 PASS. Tests use the unchanged actual helper/parsers and
versioned synthetic HTML for PC/IPAT/mobile, fallback counts, wrong venue,
non-meeting, selected race, bounded identities, date/post/clock gates, late
cancellation, privacy, total5-GET comparison cap, candidate preservation and
skip behavior. A test expectation was corrected to match the existing parser's
one-request stop on an explicitly different active venue; helper behavior was
not changed.

Full local npm run check:2397 tests /2395 PASS /2 FAIL /skip0. Both failures
require missing Chrome (JRA browser smoke and NAR viewer). Full local suite
is not PASS; Bridge must pass every test before merge GO.

One final local verification at 2026-10-16T04:50:29.135Z..04:50:35.682Z
(13:50 JST) again timed out at candidate meeting. Direct card parsing passed,
overall DIRECT_CARD_ONLY_OBSERVED, two GETs. Control was correctly NOT_PERFORMED
because candidate E2E was not observed. No actual control comparison has yet
succeeded in this phase. Preserve the earlier13:44 GitHub candidate success.
After merge run the registered workflow on main before post time; October16
Kawasaki1R requires date2026-10-16/code21/race1 strictly before15:00 JST.
