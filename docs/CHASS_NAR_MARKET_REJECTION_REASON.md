# NAR initial market rejection reason v1

Research only. Production Activation NO-GO. This change reports an explicit
safe rejection reason; it does not relax market, freshness, seal or Freeze
requirements. No app, Worker, production D1 or runtime wiring is changed.

## Live local audit on baseline main

Baseline main 9e3be7adf5d7151f3c38b4b0b225575d207fc60c (PR #140) was used for
one actual Worker request and an isolated SQLite shadow session for
2026-10-08|園田|1. Local request start: 2026-10-08T00:54:11.912Z. HTTP status
200, Worker acquiredAt 2026-10-08T00:54:21.779Z. The response had eight horses,
eight ability records, zero odds, marketStatus unavailable, UNKNOWN origin zero,
and postTime 10:40. Optional fetch errors were empty; the odds HTTP fetch audit
reported success. HTTP fetch success therefore did not establish usable market
data. The initial capture returned REJECTED/CAPTURE_FAILED before COMMIT.

Local bundle rows and commit-evidence rows both stayed zero. Closing and
reopening SQLite gave MISSING with SELECT-only reads. There were no saved bytes
to compare; this is expected absence, not loss or successful persistence.
Production D1 and the app's active state/localStorage were not written.

A direct official OddsTanFuku HTML read also returned HTTP 200 and showed all
eight win/place odds as 0.0. parseTanFuku returned zero usable entries. The
parser's exclusion of zero odds is consistent with that captured HTML. This
does not establish why official values were zero, when they will become usable,
or a general parser quality certification. No future odds are inferred.

Official source URL:
https://www.keiba.go.jp/KeibaWeb/TodayRaceInfo/OddsTanFuku?k_babaCode=27&k_raceDate=2026%2F10%2F08&k_raceNo=1

## Diagnostic change

The internal eligible() checks already reject non-frozen Signal, missing/full
coverage mismatch, duplicate/unmatched horse identity, invalid popularity and
nonpositive/non-finite odds. Their conditions and evaluation order do not change.
They now throw a private MarketEligibilityError; capture catches only this
internal type and returns MARKET_ELIGIBILITY_INVALID. Other exceptions still
return CAPTURE_FAILED without private details. External acquisition errors with
the same text cannot impersonate the internal market error.

Saved bundle schema, hashes, candidate marks, store, observer, admission reader
and formal flags are unchanged. Verification still uses its existing safe
rejection behavior. No placeholder odds, guessed popularity, retry acquisition,
time repair, insert, source rewrite or first-version replacement is added.
Existing source-preservation and formal adoption limitations remain unchanged.

## Replay and tests

The archived real Worker response was replayed through the actual isolated app
code and modified bundle capture, using synthetic clocks at sourceAt-1ms and
sourceAt+100ms and an empty read-only fixture store. It returned
REJECTED/MARKET_ELIGIBILITY_INVALID with zero insert calls. This replay is a
diagnostic of archived input, not a new official acquisition or EARLY.

Three new tests cover provisional app market with no bundle/evidence/COMMIT;
missing coverage, duplicates, zero odds and bad ranks; and safe fallback for
external/private errors. Related suites: 153/153 pass. Full local check:
1205/1207 pass, with missing Chrome and MCP SDK causing the two failures.
Full local PASS is not claimed; new patch GitHub CI is not yet run.

## Next condition and scope

A separate future fresh acquisition with complete valid frozen market evidence
is needed to test live initial persistence and readback. The archived response
cannot be retimestamped or reused as fresh. Even a successful research capture
remains HOLD for trusted durable timing and formal route/market certification.
Formal EARLY adoption and Production Activation remain HOLD and NO-GO.

Only the initial research bundle's error classification, existing SQLite
integration test and this document change. No production activation is included.
Policy: supplied "⚠️と💎の取り扱いルール.txt".
