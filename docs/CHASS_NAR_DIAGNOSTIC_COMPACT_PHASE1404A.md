# Phase140.4a: diagnostic status response size recovery

Base: main 246dea5ca493ce145e38755cdd7e2a5c0f23c64c (PR #207).

## Confirmed regression

The public JSON serializer has a 100,000-byte response cap. User's new
Phase140.4 diagnostics request returned RESPONSE_TOO_LARGE. Previously the NAR
status route returned before format parsing, so neither compact nor tabular was
implemented on that route despite the generic error recommending them. This
patch implements compact formatting rather than raising the limit.

## Public behavior

- Ordinary status without diagnostics/format/race is unchanged, including the
  full quality.horses array and no format field.
- diagnostics=1 now defaults to compact. Explicit format=compact also works.
- format=full without race preserves the previous full representation. It may
  still return the unchanged RESPONSE_TOO_LARGE guard; use compact instead.
- Unsupported format values (including tabular) return explicit INVALID_PARAMETER
  for this status endpoint; no nonexistent format is silently promised.
- race=1..99 selects a single race's status and diagnostic details and forces
  compact projection. Invalid values return 400; absent restored race returns
  404; multiple venues with the same number return AMBIGUOUS_RACE (400).
- All-race compact still includes every restored race and diagnostic aggregate.
- Selected-race responses keep date-wide savedRaceCount/rejectedRowCount, marked
  countScope=DATE, raceDetailScope=SELECTED_RACE, selectedRaceNo=<number>.
- Compact removes duplicate baseline quality.horses, keeping its summaries.
- Compact diagnostic horses includes ALL missing TIME, unavailable TIME/History,
  and nonzero/unknown held-reference counts. It omits only horses with available
  TIME and observed zero-held History, not unobserved or unknown cases.
- Race-level counts, TIME/History summaries and all affected horses' conditions
  remain intact. detailScope=AFFECTED_HORSES, displayedHorseCount and
  omittedUnaffectedHorseCount explicitly describe the filtered detail list.
- Empty displayed horses is not zero horseCount or complete career History.
- Unavailable diagnostic results remain unavailable; no successful result is
  invented. Explicit full is available when all detail is needed and fits.

Examples after approved merge/deploy:

`/api/chass/v1/public/nar-precompute-status?date=2026-10-15&diagnostics=1&format=compact`

`/api/chass/v1/public/nar-precompute-status?date=2026-10-15&diagnostics=1&format=compact&race=11`

The existing 100,000-byte guard remains for every representation. This is a
response projection only: original reader/diagnostic implementation, DATA,
hashes, Pack, writer, D1/schema, models, signals, flags, acquisition and limits
are unchanged. No new queries or fetches. GET/HEAD and no-store caching remain.
The underlying status reader still returns its full diagnostic contract to
JavaScript callers; only HTTP response formatting changes.

## Verification

A synthetic fixture uses the real runner, identity/hash verification, public
handler and 12-race/141-horse shape, with exactly 9 missing TIME and 32 held
History references. Full HTTP diagnostic response reproduces 413. Compact
returns HTTP 200 below 100,000 bytes with 12 saved / 0 rejected and all 21
separate affected horses, 9/32 aggregates and condition detail. Stored row bytes
remain unchanged. This is synthetic, not the production 9/32 classification.

A second real-handler fixture has 30 missing-TIME horses and 150 ambiguous
History references (five per horse) in the selected race. Its compact response
fits below 100,000 bytes, with date-wide counts clearly distinct from selection.
Arbitrary all-race worst cases may still require selecting a race; the cap is
never bypassed or raised.

Unit tests cover frozen input, unchanged totals, affected/unknown retention,
selection scope, unavailable diagnostics and ordinary status. API tests cover
explicit/default compact, explicit full, default legacy shape, invalid format,
invalid/missing races, HEAD, byte headers and no-store.

After Bridge audit and approved merge, verify ordinary 12/0 readback and request
compact diagnostics. Review the actual 9 TIME / 32 History condition details.
MODEL_HOLD / researchOnly / formalKpiEligible=false / productionActivationReady=false
remain. 404 source root cause remains a separate unresolved issue.

## Local results (2026-10-15 JST)

- New tests: 9 PASS (6 pure projection + 3 public-handler regressions).
- Related eight-file suite: 136 PASS, 0 fail.
- Representative 12-race/141-horse compact HTTP body: 38,986 bytes.
- Selected race, 30 missing TIME / 150 held references: 77,750 bytes.
- Full npm run check: 1944 total / 1942 PASS / 2 FAIL.
- Two Chrome-dependent browser tests fail because Chrome is not installed.
  Full local check is not PASS; CI remains pending.
- node --check for worker.js/new module and git diff --check: PASS.
- Temporary local dependency symlink removed; no dependency files changed.
- No production migration, write, deploy or merge performed.
- Production compact readback and actual 9/32 condition classification pending.
