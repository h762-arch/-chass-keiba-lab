# Phase140.23: bounded meeting-source and URL-encoding probe

Base: a08c0f95161fdb501149404cc4e0dfeb60d2aca1 (merged PR #226).

## Purpose and invocation

The collector recorded three HTTP 404 meeting-source responses for October 16
Kawasaki, while a different web retrieval displayed twelve races. The existing
record does not contain response fingerprints or redirect information. This
standalone diagnostic observes fixed official routes without changing them in
production, and compares the encoded-date PC URL to a raw-slash date variant.

```sh
node scripts/probe-nar-meeting-sources.mjs --bundle /absolute/path/bundle.json --date 2026-10-16 --code 21
```

Four new files only: this document, a research probe module, a local CLI and
tests. No Worker endpoint, workflow, D1, collector, mapping table, parser,
collection conditions, runtime flag, request header or production timeout changes.
No saved DATA, History, Pack, TIME, Original EARLY signal or mark is rewritten.

The CLI requires exactly these ordered arguments. Its regular local file must
be at most 1 MB, strict UTF-8 and JSON. Arbitrary URL, token, timeout, clock and
historical flags are rejected. The date/code arguments override any injected
CLI test options, never bundle-provided instructions.

## Source gate and request contract

Re-run Phase140.22 audit from the original raw bundle at the actual initial
clock. Require an integrity/freshness VERIFIED mirror, a valid fresh recorded
run, the code in captured trackCodes, and MEETING_SOURCE_UNAVAILABLE for that
same track. Other unresolved source/run conditions, absent failure evidence,
wrong date, stale/future or inconsistent input stop before network. No historical
mode or freshness override exists. The source is cloned before awaited IO.

Execute exactly one GET per fixed target, in order:
1. Existing www.keiba.go.jp /KeibaWeb/TodayRaceInfo/RaceList, encoded date.
2. Same PC path and parameter order, with YYYY/MM/DD left as literal slashes.
3. Existing www.keiba.go.jp /KeibaWeb_IPAT/TodayRaceInfo/RaceList_ipat, encoded date.
4. Existing sp.keiba.go.jp /KeibaWebSP/TodayRaceInfo/S_RaceList, encoded date.

These are four deliberate observations, not retries or collector fallback.
Each GET uses redirect=manual and credentials=omit, without adding custom
headers or spoofing a client. No redirect is followed and no caller URL is used.
Each standalone diagnostic request has a 5-second fetch/body deadline and 1 MB
streaming cap (declared content length is checked independently). Thus up to
four transport deadlines may be spent. This does not change the production
meeting reader's separate total 5-second budget or authorize its use in a job.
The deadline does not claim to bound synchronous CPU work.

Abort/cancel on timeout or completion. Late responses cannot yield a success
or mutate returned observations. A configurable test/API port permits integer
perRequestTimeoutMs=1..5000; the CLI exposes no timeout flag. Clocks must be
finite and nondecreasing across the whole probe. A clock error stops subsequent
requests. Recheck mirror and run freshness at completion; an expired source
yields HOLD with the actual final source verdict, not the initial VERIFIED one.

## Output interpretation

Each observation contains only the fixed request URL/route/time, HTTP status,
bounded content-type category, redirected flag, a same/other-origin/missing/
invalid redirect-target classification, byte count, received-byte SHA-256 and
sanitized meeting status/race numbers. No raw HTML, arbitrary MIME or redirect
URL, horse names, body/error text, cookie, credential or private fields are emitted.
Location credentials or unsupported schemes are INVALID and never followed.

Only an HTTP 200 nonredirected HTML body is decoded strictly as UTF-8 and passed
to the existing unchanged PC/mobile meeting parser. Date/venue context and
bounded race numbers are checked. Wrong context, ambiguous/non-meeting text,
unsupported content type, malformed body or transport failure cannot establish
a matching meeting response. A parser observation is not full card acquisition.

Top-level MEETING_RESPONSE_OBSERVED means at least one matching nonempty meeting
response was observed here. Probe completeness separately reports COMPLETE or
PARTIAL; partial transport failures remain visible with SOME_PROBES_UNAVAILABLE.
Without a meeting response, top-level HOLD/MEETING_NOT_CONFIRMED remains.
HTTP errors can still be fingerprinted as RESPONSE_OBSERVED without being
described as a meeting. Missing evidence is never converted into zero races.

encodingComparison compares the two PC outcomes only when both responses were
observed: SAME_RECORDED_OUTCOME or DIFFERENT_RECORDED_OUTCOME. Otherwise it is
UNAVAILABLE. Sequential observations can differ for many reasons; this field
does not establish causality or choose a winning route. Full body hashes can
also differ because of unrelated dynamic page content.

executionBasis=STANDALONE_FETCH_NOT_WORKER_REPLAY remains explicit. The original
collectionAudit stays HOLD with its original saved/attempted counts; the result
says recordedFailureNotResolved=true and automaticSourceSwitchAllowed=false.
Even a matching response does not prove successful production fetching, card
parsing, D1 save, continued availability, root cause or an approved source change.
CLI exit 0 means a meeting response was observed; exit 1 means HOLD.
Probability MODEL_HOLD, formalKpiEligible=false, acquisitionCertified=false,
currentStatusEligible=false, diagnosisStatus=NOT_ESTABLISHED and Production
Activation NO-GO remain fixed. October 18 code-22 acquisition stays separate.

## One confirmed real probe, October 16 JST

One CLI run used the unmodified bundle read from fixed chass-data commit
25a2a417d321cec24c752ed88714caf6a10e924b, capturedAt=2026-10-16T00:51:24.947Z.
The recorded source had attempted=0, saved=0 and the three SOURCE_HTTP/404 events.
Probe start=2026-10-16T01:16:02.479Z (10:16 JST), finish=01:16:21.345Z,
requestCount=4. Final source mirror remained VERIFIED and recorded collection
remained HOLD. Per-route evidence:

- Encoded PC: PROBE_TIMEOUT, no HTTP status observed.
- Raw-slash PC: HTTP 200, HTML, no redirect, 61,886 response bytes,
  SHA-256=047bfae772eaea50d5bde140f548ea15e6b2a5b55129e6e534e4c17a166bee97.
  Started 01:16:07.482Z, finished 01:16:11.344Z. The existing parser returned
  matching Kawasaki/2026-10-16 with race numbers 1 through 12.
- Encoded IPAT and mobile: PROBE_TIMEOUT, no HTTP statuses observed.

Result: MEETING_RESPONSE_OBSERVED, PARTIAL, SOME_PROBES_UNAVAILABLE,
encodingComparison=UNAVAILABLE. The encoded PC timed out, so this is not a
controlled proof that percent-encoded date slashes caused production 404.
The raw-slash URL is an observed candidate for later independent validation;
it is not installed as a production fallback by this patch. No successful
production collection/save or historical venue comparison is newly established.

## Verification

New tests: 24 PASS. Existing related tests: 152 PASS; combined 176 PASS.
Tests cover all fixed routes, exact request behavior, unchanged parser use,
encoding outcomes, HTTP/body fingerprints, redirects without location leakage,
source/track/date gates, wrong identity, stale inputs, config/clock errors,
fetch/body timeout, late cancellation, byte/UTF8/body limits, immutable pinned
source, completion freshness, model/governance gates and bounded local CLI.

Full local npm run check: 2,263 tests / 2,261 PASS / 2 FAIL / skip 0. Failures
require missing local Chrome (jra-browser-smoke and viewer-nar-ability-browser).
The complete local suite is not PASS; Bridge must pass every test before merge GO.
