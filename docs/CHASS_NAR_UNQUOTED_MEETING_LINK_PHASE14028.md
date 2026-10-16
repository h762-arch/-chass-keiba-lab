# Phase140.28: unquoted meeting-anchor href support with unchanged identity gates

Base: ae6e9d88113a18fa70d8b6324d8a9bd2cb393458 (merged PR #231).

## Evidence and scope

GitHub run38850831031 / attempt1 on that exact commit captured Kawasaki's
meeting menu at 2026-10-16T04:28:58.418Z..04:28:59.659Z (13:28 JST): HTTP200,
races1..12. Phase140.27 found27 quoted hrefs, zero matches, with24 path and3
origin rejections. Its syntactic anchor inspection counted27 unquoted hrefs,
zero base tags and zero onclick attributes. Selected-race/card-like samples
were empty because only quoted hrefs fed the acceptance validator.

The independent card GET parsed successfully:12 runners,12 active finite
ability values,11 nonempty predictedTime fields. Overall DIRECT_CARD_ONLY_OBSERVED
/ RACE_LINK_IDENTITY_INVALID. Artifact12025310822 ZIP SHA256:
a52b5dab506299da4b54d11bc07e70add797db4c9c202b69e7f72f8c0d5fb3de.
JSON SHA256 matched the separate digest, exact stdout bytes and run metadata:
12593a106c0474b8266e667e7fe5b2cd1bb2e26379b7d310132346d530ea629f.

These observations justify inspecting unquoted anchors. They do not prove
that the27 unquoted values contained a valid selected-race link. This change
adds a bounded unquoted-anchor input path to the same identity validator;
actual success and the precise earlier cause still require a new live run.

Only four files change: new internal scanner, research link-audit module,
existing link-audit tests and this document. Production runtime/collector,
D1, source routes, existing parsers, collection conditions, limits, models,
existing workflows and templates remain unchanged. No History/DATA/Pack,
TIME, Original EARLY signal or saved snapshot is repaired or rewritten.

## Narrow unquoted-anchor scanner

extractNarUnquotedAnchorHrefs accepts at most1MB UTF-8 HTML and extracts only
actual a start tags with one unquoted href. It walks start-tag boundaries with
quote-aware tag endings, matches exact case-insensitive attribute names and
uses ASCII whitespace. Quoted title text or data-href is not an href. Other
attributes may precede or follow href; duplicate href attributes are rejected
by the new path, including mixed quoted/unquoted duplicates.

Retain '=' inside unquoted URL query values. HTML's tokenizer appends an equals
sign to an unquoted value even though it records a parse error; stopping at '='
would discard the query identities. Reject embedded quotes, backticks, controls,
less-than and malformed attribute boundaries rather than emulate all browser
error recovery. The source for that tokenization detail is the HTML Standard:
https://html.spec.whatwg.org/multipage/parsing.html#attribute-value-(unquoted)-state

Skip comments, declarations and raw-text contexts (including script/style,
textarea/title and the declared unsupported raw containers). Skip template,
SVG and MathML contents, including nested templates; self-closing foreign
containers do not swallow following HTML anchors. Unterminated tags/raw-text
or comments fail closed. No script/onclick execution or arbitrary URL fetching.
This is a deliberately narrow scanner, not a full browser DOM parser or full
HTML error-recovery/namespace implementation. Unsupported markup can stay HOLD.

The scanner's raw href strings exist only internally as validator inputs;
no raw strings, HTML or arbitrary attribute/query values are put in reports.

## Identity validation and diagnostic compatibility

Keep the old quoted-href acceptance path and its original limitations unchanged.
Only new unquoted a/href candidates use the narrow scanner. Both feed the exact
same existing URL/identity predicate: official HTTPS origin, no credentials,
original allowed DebaTableSmall/DebaTable/RaceMarkTable path, exactly one each
k_babaCode/k_raceDate/k_raceNo, exact venue code and padded slash date, original
race syntax and numeric equality. No new date, race, scheme, entity-decoding,
route or base-tag normalization. Existing supported &amp;/&#38; and decoded
percent slash forms still work; invalid duplicates/other dates stay rejected.

acceptancePolicy=PHASE14028_UNQUOTED_ANCHOR_EXTENSION and
identityPolicy=UNCHANGED_PHASE14024 distinguish syntax from identity rules.
The preflight still requires actual current-date meeting identity, selected
race membership and a matched link before deriving its own fixed card URL.
It never follows a supplied href or uses a base hint for acceptance.

quotedHrefCount/rejectionCounts/hrefKindCounts retain Phase140.27's legacy
quoted-scanner meanings. quotedMatchedCount is explicit. unquotedHrefCount,
unquotedMatchedCount, unquotedRejectionCounts and narrow-scan anchor/rejection
counts identify the new path. matchedCount sums accepted candidates from both
paths; matched is true only when that total is positive. Samples from unquoted
anchors are labeled attributeForm=UNQUOTED_ANCHOR. Existing8+4 sample caps and
full aggregate scanning remain. samplesComplete accounts for both scan paths.
Legacy syntax/base hints remain diagnostic only, not authoritative DOM evidence.

## Execution and governance

Registered source-probe v1 already invokes this auditor through preflight;
after merge a new main manual dispatch includes the new fields. No workflow
registration or edit is needed. Meeting-to-card success stops after2 GETs;
failure retains the separate direct-card inspection, at most3 GETs overall.
No added external reads, retries, alternate sources, odds/results requests or
collector invocation. Each unchanged reader retains5seconds/1MB/manual redirects,
strict UTF-8, current-date and strict-before-post checks.

Keep MODEL_HOLD, NO-GO, formalKpiEligible=false and acquisitionCertified=false.
A successful standalone run does not certify Worker acquisition, persistence,
readback, production recovery or cause. Missing TIME remains missing.
October18 code22 acquisition remains a separate pending trial.

## Verification and actual limits

New24 tests plus existing22 link-audit tests:46 PASS. Other related tests148
PASS; total194 PASS. Synthetic cases exercise actual unchanged parsers and the
registered runner with unquoted meeting anchors, successful2-GET stop, rejected
identities and separate direct-only outcomes. Negative cases cover query '='
preservation, duplicate href/query parameters, wrong origin/credentials/routes,
dates/races, comments/raw-text/templates/foreign contexts, malformed attributes,
no base-hint authorization, sample bounds, privacy and zero extra network.

Full local npm run check:2377 tests /2375 PASS /2 FAIL /skip0. Both failures
require absent Chrome (JRA browser smoke and NAR viewer). Full local suite is
not PASS; Bridge must pass every test before merge GO.

One actual local final verification ran 2026-10-16T04:35:06.266Z..
04:35:13.631Z (13:35 JST), Kawasaki1R. Meeting GET timed out with SOURCE_DEADLINE,
so neither unquoted-link evidence nor meeting-to-card E2E could be observed.
Separate direct card again parsed successfully; overall DIRECT_CARD_ONLY_OBSERVED,
requestCount2, exit1. This is not proof that unquoted support resolves the actual
page. After merge, manually run source-probe v1 on main before post time; for
October16 Kawasaki1R only before15:00 JST: date2026-10-16/code21/race1. Match
run SHA, artifact digest and reported unquoted matches before confirming cause.
