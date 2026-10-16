# Phase140.25: independent read-only direct card inspection

Base: 802dcf22c0b552b6faeab723fe6e2fd34ded684b (merged PR #228).

## Purpose

Phase140.24 could not reach its card stage because the meeting GET timed out.
This separate diagnostic inspects one explicitly selected card directly. It
does not relax, replace or satisfy the existing meeting-to-card preflight gate.
No synthetic meeting response, cached meeting or old mirror is supplied.

```sh
node scripts/inspect-nar-direct-card.mjs --date 2026-10-16 --code 21 --race 1
```

Exactly four new files: this document, a research module, its CLI and tests.
Production runtime, collectors, source routes, D1, workflows, collection
conditions, limits, models and existing parsers are unchanged. No History,
DATA/Pack, TIME or Original EARLY signal repair or rewrite is performed.

## One bounded GET

Require a real current JST date, an allowlisted two-digit venue code and an
integer race 1..20. Venue routing remains 22=Kanazawa, 23=Kasamatsu.
The CLI accepts only the six ordered arguments above. No URL, token, DB, save,
historical, clock or timeout argument is exposed. Explicit CLI identity wins
over injected test options. The API permits an injected clock/fetch and a
1..5000 ms test timeout; its production default is 5000 ms.

Derive only this fixed official source locally, with literal date slashes:
https://www.keiba.go.jp/KeibaWeb/TodayRaceInfo/DebaTableSmall?k_babaCode=21&k_raceDate=2026/10/16&k_raceNo=1

Use unchanged fetchNarPrecomputeHtml: one external GET, manual redirects,
strict UTF-8, 1 MB streaming bound and a five-second default deadline. Make
GET and credentials=omit explicit, adding no custom headers. Require HTTP200
and text/html. No meeting request, retry, alternate endpoint, next race, sweep,
collector fallback or optional external request follows any result.
Late responses are cancelled before mutating returned request evidence.
The transport deadline does not bound synchronous parser CPU execution.

## Existing parser gates

Require assertNarAbilityCardIdentity on the captured header before invoking
unchanged buildNarRacePayloadStable. Its only available fetcher result is the
already captured card HTML; optional card/result and odds paths are disabled
locally and never perform network reads. No global fetch is invoked by parsing.

Validate parsed organization/date/code/track/race, no result markers, supported
surface and bounded distance, a valid post time, 2..30 distinct bounded runner
numbers and valid names, no market data, and at least two active finite ability
scores. Accept the existing parser's canonical string horse numbers. Retain
only race context and aggregate counts, not horse names, scores, TIME values,
odds or raw HTML. activeTimePresentCount measures only nonempty existing
predictedTime fields; it does not validate times independently or repair them.

The clock must be finite and nondecreasing. Check current JST date initially,
before GET, after capture and after parsing. Before-GET rollover means zero
requests; later rollover cannot yield a positive observation. At parse
completion require strictly before post time; the exact post boundary is HOLD.
Captured transport evidence and valid partial aggregate counts can remain on
HOLD, without fabricating missing card context or promoting freshness.

## Output boundaries

DIRECT_CARD_PARSE_OBSERVED means only that this one direct read and the stated
local parser gates passed. CLI exit 0 represents this observation, not production
readiness. HOLD exits 1. A response timeout is unavailable evidence, not proof
of a non-meeting, an absent card or a particular production failure cause.

Always retain meetingVerified=false and meetingToCardStatus=NOT_PERFORMED.
The Phase140.24 meeting gate is still mandatory for that separate tool; this
module is not imported by production or by that tool. collectionStatus and
mirrorFreshness remain NOT_EVALUATED, even on positive card observation.

Always retain executionBasis=STANDALONE_FETCH_NOT_WORKER_REPLAY,
acquisitionCertified=false, currentStatusEligible=false, snapshotCreated=false,
savedDataVerification=NOT_PERFORMED, productionSourceChanged=false,
diagnosisStatus=NOT_ESTABLISHED and production404Cause=NOT_ESTABLISHED.
Probability remains MODEL_HOLD; formalKpiEligible=false; Production Activation
remains NO-GO. No automatic save, trigger or source switch follows.
October 18 code-22 acquisition remains a separate pending trial.

Request metadata includes only the fixed URL/route, available HTTP status,
capture state, clock timestamps, limits and the HTML fingerprint. The unchanged
HTTP reader returns decoded text, not raw received bytes. Thus
fingerprintBasis=DECODED_HTML_UTF8_REENCODED, decodedUtf8Bytes and
decodedHtmlSha256 are explicit. A removed UTF-8 BOM changes a received-byte
hash; do not equate this hash with Phase140.23's responseBytesSha256.

## Actual observation and verification

One explicit development verification started 2026-10-16T02:38:40.749Z
(11:38 JST), code21 / race1. The single direct card GET reached its five-second
deadline: HOLD / SOURCE_DEADLINE, requestCount=1, card=null. No real card parse,
meeting-to-card E2E, Worker recovery or successful persistence was established.
The earlier Phase140.23 meeting response remains a separate observation, not
evidence of sustained availability or a proven URL-encoding cause.

The fetched chass-data reference during this phase was still
25a2a417d321cec24c752ed88714caf6a10e924b, with latest capture
2026-10-16T00:51:24.947Z (09:51 JST). It is older than 30 minutes at this phase's
verification time. This tool does not refresh, reconstruct or relabel that
mirror as current. Scheduled publication success was observed historically;
continued fresh publication and current collection recovery remain unconfirmed.

New tests: 23 PASS. Related existing tests: 153 PASS; combined 176 PASS.
Synthetic HTML uses existing versioned rehearsal fixtures adapted to Kawasaki,
through the actual header and payload parsers. Tests cover exactly one GET,
no optional network or synthetic meeting, false certification flags on success
and failure, identity/context/field/ability gates, current date/post boundaries,
HTTP/redirect/content/UTF8/size/deadline failures, late cancellation and immutable
evidence, clock failures, decoded-BOM hashes, privacy and strict CLI behavior.

Full local npm run check: 2310 tests / 2308 PASS / 2 FAIL / skip 0. The two
failures require absent local Chrome (JRA browser smoke and NAR viewer). The
full local suite is not PASS. Bridge must pass all tests before merge GO.
