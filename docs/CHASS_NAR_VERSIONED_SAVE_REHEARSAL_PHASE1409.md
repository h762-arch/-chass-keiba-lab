# Phase140.9: isolated versioned-save integration rehearsal

Base: 15113094a543e4364a46355d89e8b60fb7fce8c2 (Phase140.8).

## Purpose and limits

Exercise a new save across codes 22 (金沢) and 23 (笠松) using the existing
production modules, before interpreting a future live save as production evidence.
This patch adds only a CLI, synthetic fixture generator, tests and documentation.
No production runtime, existing parser/model, writer, reader, diagnostic module,
wrangler, schema or migration is modified.

All fixture pages are synthetic, explicitly named synthetic, and use a fixed
clock/date. The 2026-10-16 date is a test clock, not a claim that either venue is
scheduled that day. Reports carry SYNTHETIC_REHEARSAL and productionEvidence=false.
PASS means the selected synthetic scenario behaved as expected, including expected
rejection in the tampered-readback case. It does not prove live availability,
real horse identity, a live 22/23 acquisition, Probability integration or formal KPI.

## Reproduce

Use the same Node version as CI (node:sqlite support required; tested on Node 24):

```sh
node scripts/nar-versioned-save-rehearsal.mjs
node scripts/nar-versioned-save-rehearsal.mjs --scenario swapped_card
node scripts/nar-versioned-save-rehearsal.mjs --scenario history_link_failure
node scripts/nar-versioned-save-rehearsal.mjs --scenario time_gap
node scripts/nar-versioned-save-rehearsal.mjs --scenario tampered_readback
```

Exit 0: expected checks PASS. Exit 1: FAIL or rejected CLI arguments.
No DB path, external URL, credentials, fetch implementation or runtime environment
binding is accepted. Each call creates and closes its own SQLite :memory: DB.
The fixture transport accepts only the two codes, fixed date/race and three
pre-race page paths. It cannot fetch result or horse-history pages. Real global
fetch is blocked in the baseline integration test and its call count stays zero.

The local DB schema is initialized from unchanged repository migrations. All
writes stay in memory; no production D1 operation or persistent database is used.
The tampered-readback scenario intentionally changes only its ephemeral snapshot
and recomputes its outer hash, then verifies that readers still reject it.

## Integration path

- Existing precompute meeting fetch and official-shaped RaceList parser.
- Existing bounded HTML fetch, card identity check, card parser, retained past-run
  parser, ability/TIME computation and stable race-payload builder.
- Existing full-card link parser, versioned History identity bridge and shared
  research store, including stored observation readback and Rolling projection.
- Existing pre-analysis V4 pack, snapshot writer, hash/identity validation.
- Existing status reader, public compact status, Viewer and stored-version audit.
- Existing ALREADY_SAVED rerun; readers/rerun use a SELECT-only DB port and must
  preserve all snapshot and shared observation bytes.

No Cron handler or other scheduled job is invoked. Production track code 21,
collection window and job limits are not changed. Codes 22/23 are enabled only
inside the ephemeral rehearsal environment. The optional result/odds payload
ports are blocked in the same way as the production precompute card callback.

## Expected synthetic outcomes

| Scenario | First saves | Accepted readback | Rejected rows | Shared observations | Meaning |
| --- | ---: | ---: | ---: | ---: | --- |
| baseline | 2 | 2 | 0 | 8 | Four horses, two versioned episodes per horse |
| swapped_card | 1 | 1 | 0 | 4 | Wrong-venue card blocked; other route completes |
| history_link_failure | 2 | 2 | 0 | 4 | Ability/TIME retained; affected link/store HOLD |
| time_gap | 2 | 2 | 0 | 8 | One missing TIME remains missing |
| tampered_readback | 2 | 1 | 1 | 8 | Unsupported saved routing version rejected |

Baseline routing version: NAR_VENUE_ROUTING_22_23_V1.
Baseline History version: NAR_HISTORY_VENUES_22_23_V1, two horses per race.
Both pre-analysis packs remain V4/PARTIAL and model connection remains HOLD.
Shared observations are research-only; two retained episodes are not full career
coverage. Snapshot hashes may differ across fresh calls because audit elapsedMs
is measured; byte-invariance is checked within each database on read/rerun.

## Validation and gates

New tests: 11 PASS. Related suites: 118 PASS. Full npm run check: 1995 tests,
1993 PASS, 2 FAIL due to missing local Chrome (jra-browser-smoke and
viewer-nar-ability-browser). Bridge must perform full CI with Chrome before merge.
Runtime syntax, exact-base apply, whitespace and gzip/Base64 checks are part of
patch packaging. Existing twelve-race readback regression remains in the suite.

Merge HOLD until Bridge and independent audit. This test/tool-only patch does not
require another production readback cycle solely to prove a runtime change.
Next production evidence must come from a genuinely new eligible pre-cutoff save;
existing 2026-10-15 rows remain immutable and ALREADY_SAVED. No backfill or canary
extension is included. researchOnly=true, formalKpiEligible=false,
productionActivationReady=false, Probability MODEL_HOLD and Activation NO-GO.
