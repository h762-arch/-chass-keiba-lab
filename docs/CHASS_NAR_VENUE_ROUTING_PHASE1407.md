# Phase140.7: correct live NAR venue routing without breaking frozen readback

Base: d3c0a0902fe9ad6d506a0fdf849b12817de60aca (Phase140.6).

## Routing contract

Correct code 22 to 金沢 and code 23 to 笠松 in eight existing tables:
Worker, local server, browser UI, Worker wrapper, day prefetch, scheduler,
recent-history target-track summaries, and ability precompute. Other codes retain
their current interpretation and are not claimed independently verified here.
Explicit contradictory track/code pairs on prefetch and race-context requests
return 400 before external acquisition.

Primary evidence checked 2026-10-15:
- https://www.keiba.go.jp/KeibaWeb/TodayRaceInfo/CompeteTable?k_babaCode=22&k_raceDate=2026%2F07%2F20&k_raceNo=6
- https://sp.keiba.go.jp/KeibaWebSP/TodayRaceInfo/S_RaceList?k_babaCode=23&k_raceDate=2026%2F07%2F08

## Immutable snapshot compatibility

New ability saves include DATA.venueRoutingVersion=NAR_VENUE_ROUTING_22_23_V1,
covered by the existing outer snapshot hash. Both status and Viewer readers
select the code/name table by this recorded version. A missing field selects the
original table; null/unknown versions reject. Legacy rows retain their original
names and hashes; keeping them readable does not certify that their original
venue labels were correct. No silent relabeling or archive repair is performed.

The synthetic legacy 22/23 snapshot fixture was captured from the unmodified base
before these changes. The mixed test combines both frozen rows with new saves at
both codes and checks unmodified bytes, correct new labels, status counts and
track-filtered Viewer reads. Inconsistent routing versions are rejected even
when the test recomputes the outer hash. As with History, these are consistency
hashes, not signatures; a fully recomputed equivalent package is not proof of
which software originally generated it.

ALREADY_SAVED continues to skip existing race IDs. No revision backfill,
production D1 migration or write, saved prediction edit, or History mapping/hash
rule change is included in patch preparation. Previously discovered historical
collector job cursors and archived race records are not rewritten; this patch
does not certify or repair historical records collected with the old table.

## Meeting cache compatibility

Unversioned 金沢/笠松 meeting cache entries may derive from the reversed table.
They are bypassed in Worker single/date reads and UI local cache/freshness checks,
without deletion. A normal subsequent official meeting acquisition carries the
new marker. Existing meeting cache writes persist it inside the existing JSON
payload, so no schema migration is needed. Other venues keep their old cache
reuse behavior. Server discovery also returns the marker for local UI use.

The mutable meeting calendar can be refreshed by existing request/collector
flows after deployment; this is distinct from immutable prediction snapshots.
The patch does not start or extend a collector, change configured track codes,
change request budgets, or request a production refresh during preparation.

## Verification and gates

Related suites: 121 PASS. Full npm run check: 1973 tests, 1971 PASS, 2 FAIL because
Chrome is unavailable (jra-browser-smoke, viewer-nar-ability-browser). Bridge must
run the complete check with Chrome before merge GO. Runtime syntax checks,
diff whitespace check, exact-base apply check and Base64/gzip roundtrip are
required for the distributed patch. Production readback is still pending.

Tests cover all eight table pairings, actual Worker/precompute request URLs,
mobile fallback, prefetch plan URLs, scheduler fanout, recent-history target
track, legacy cache bypass, fresh cache write/read reuse, UI freshness, conflicting
request rejection, mixed snapshot readback and invalid routing versions. Existing
Phase140.6 twelve-race readback regression remains in the full suite.

wrangler, acquisition caps/window, D1 schema/migrations, model, TIME predicates,
Signal rules and Phase140.6 History identity versions remain unchanged.
Probability MODEL_HOLD, researchOnly true, formalKpiEligible false,
productionActivationReady false. Merge HOLD until independent Bridge audit;
Production Activation remains NO-GO.
