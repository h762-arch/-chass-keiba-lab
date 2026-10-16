# Phase140.24: read-only candidate meeting-to-card preflight

Base: 3b3b3b71677edd918082e6a5bb59c98147a9a62a (merged PR #227).

## Purpose and invocation

Phase140.23 observed twelve Kawasaki races once from the raw-slash-date PC URL.
That was neither a production fix nor evidence that a card could be parsed.
This standalone tool checks the candidate meeting and one selected card through
the existing parser, with no collector invocation, DB access or saved snapshot.

```sh
node scripts/preflight-nar-candidate-card.mjs --date 2026-10-16 --code 21 --race 1
```

Four new files only: this document, a research module, a CLI and tests. No
production runtime, source route, parser, workflow, D1, collection condition,
limit, model, History/DATA/Pack, TIME or Original EARLY signal change.

This is an independent public-page inspection, not a refresh/relabeling of a
GitHub mirror. The latest data branch observed during preparation was still
25a2a417d321cec24c752ed88714caf6a10e924b, captured 09:51 JST. It was older than
30 minutes when this phase began. This tool does not reconstruct a fresh bundle
under that old commit or promote its stale freshness verdict.
mirrorFreshness and collectionStatus remain NOT_EVALUATED here.

## Fixed two-stage read

Require a real current JST date, an allowlisted two-digit venue code and integer
race 1..20 before network. The CLI accepts only the six ordered arguments above;
no URL, credentials, DB, save, historical, clock or timeout options. Explicit
date/code/race arguments override any injected test options. The API clock is
finite and nondecreasing; JST date is checked before and after each request and
after parsing. Date rollover prevents subsequent reads and positive results.

First GET the fixed www.keiba.go.jp /KeibaWeb/TodayRaceInfo/RaceList URL, with
k_babaCode followed by literal YYYY/MM/DD date. Use unchanged parseNarRaceList;
require matching track/date, a nonempty bounded race list and the selected race.
Independently require an official same-origin selected-race link whose path,
date, venue code and race number agree, with no duplicate identity parameters.
No link URL from the body is followed; the subsequent URL is locally derived.

Only then GET the fixed /KeibaWeb/TodayRaceInfo/DebaTableSmall URL with the same
date/code and selected race. Require the unchanged assertNarAbilityCardIdentity
header check before invoking unchanged buildNarRacePayloadStable. Its only
permitted fetcher result is the already-captured card HTML. Optional result/card
and odds requests are locally rejected and perform no network read.

Both external reads use existing fetchNarPrecomputeHtml, retaining its manual
redirect policy, strict UTF-8, 1 MB streaming cap and 5-second per-read deadline.
The wrapper makes GET/credentials=omit explicit and adds no custom header.
At most two external GETs, each once; no retry, alternate source, next race,
parallel sweep or collector fallback. A first-stage failure stops after one GET.
The two standalone deadlines do not alter the production collector's total
meeting budget or authorize new production behavior. They bound transport,
not synchronous parser CPU execution. A test/API timeout port allows 1..5000 ms;
the CLI does not expose it. Late responses are cancelled before mutating audit
metadata and cannot advance to card parsing or change returned results.

## Parser and pre-start gates

After parsing, verify organization/date/track/code/race, no result-snapshot marker,
supported surface/distance, valid post time and 2..30 distinct bounded runners.
The existing parser returns normal horse numbers as strings; validate their
canonical integer form rather than treating them as malformed. Reject invalid
names/identities, unexpected market data and impossible race context. Retain
only aggregate card context and counts, never horse names, scores, TIME values,
odds, arbitrary text or raw HTML.

At parse completion, require current JST date and time strictly before post.
Exactly post time is HOLD. Require at least two active finite ability values,
matching the existing collector's basic score gate. Missing TIME values alone
are not repaired or replaced. activeTimePresentCount is only a count of the
existing parser's nonempty predictedTime fields, not independent time validation.
Candidate-card observation is not a data-quality, History/Pack or activation GO.

## Evidence and output meaning

Requests record only fixed source URL/route, actual available HTTP status,
capture state, times, limit and HTML fingerprint. The reused HTTP reader returns
decoded text, not original bytes: fingerprintBasis is explicitly
DECODED_HTML_UTF8_REENCODED, with decodedUtf8Bytes/decodedHtmlSha256. A stripped
UTF-8 BOM can change the received-byte hash. Do not compare this fingerprint as
if it were Phase140.23's raw responseBytesSha256. No raw HTML is persisted.

CANDIDATE_CARD_OBSERVED means the two direct reads and the listed local parser
gates passed. It does not mean the Worker can fetch them, a D1 row was written,
an existing snapshot/hash passed readback, a live source was corrected or
continued availability was established. On HOLD, retain captured transport and
validated partial context where available, without fabricating card counts.
CLI exits 0 for CANDIDATE_CARD_OBSERVED and 1 for HOLD.

executionBasis=STANDALONE_FETCH_NOT_WORKER_REPLAY, acquisitionCertified=false,
currentStatusEligible=false, productionSourceChanged=false, snapshotCreated=false,
collectionStatus=NOT_EVALUATED and mirrorFreshness=NOT_EVALUATED remain explicit.
Probability MODEL_HOLD, formalKpiEligible=false, diagnosisStatus=NOT_ESTABLISHED
and Production Activation NO-GO remain fixed. No production save, trigger or
automatic source switch follows. October 18 code-22 acquisition stays separate.

## Real-read results and limits

One initial implementation check started 2026-10-16T01:50:12.328Z (10:50 JST).
It reached the 5-second meeting-read deadline, returned HOLD/SOURCE_DEADLINE,
requestCount=1, meeting=null, card=null. After strengthening link/runner/late-read
guards, one final CLI verification started 2026-10-16T01:56:30.982Z (10:56 JST).
It again returned HOLD/SOURCE_DEADLINE at the first GET, with no card request.
These were two explicit development/verification invocations; the tool performs
no internal retry. Both results are retained in the validation evidence.

No real meeting-to-card success was established in this phase. Phase140.23's
single matching meeting response remains a separate earlier observation. It
does not prove repeatability, a specific encoding cause, production collection
recovery or a successful card parse. Do not change a production source based on
the synthetic success fixtures or present the failed reads as non-meetings.

## Verification

New tests: 24 PASS. Existing related tests: 136 PASS; combined 160 PASS.
Synthetic official-page-shaped HTML comes from the existing versioned rehearsal
fixtures, adapted to Kawasaki. Tests use the actual meeting/header/payload
parsers and cover two fixed GETs, zero optional network, normal string runner
numbers, exact link/identity/context gates, old/future/current date behavior,
JST rollovers, completion post boundary, missing ability, HTTP/content/UTF8/byte
errors, timeout/late cancellation, immutable audit, decoded-BOM hash semantics,
private-text containment and strict CLI identities/argument limits.

Full local npm run check: 2,287 tests / 2,285 PASS / 2 FAIL / skip 0. Both failures
require unavailable local Chrome (jra-browser-smoke and viewer-nar-ability-browser).
The complete local suite is not PASS; Bridge must pass every test before merge GO.
