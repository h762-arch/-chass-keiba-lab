# Phase140.32 — offline NAR research mirror consistency audit

This phase adds four files: a pure auditor, a local CLI, tests and this document.
It does not change the publisher, runtime, collection conditions, D1 or workflows.

## Input and use

```sh
node scripts/audit-nar-research-mirror.mjs --bundle /local/bundle.json --date 2026-10-16 --slug kawasaki
```

The bundle contains `commitSha`, `attempt`, `snapshot`, `manifest`, `day` and
`raceFiles`. Each race-file item is `{path, payload}`. Retrieve all original JSON
files at one fixed commit; do not mix a moving branch ref into the bundle. Read
the latest attempt even if it reports failure. `commitSha` is a caller declaration,
not an authenticated lookup by this offline function.

The CLI reads one regular local file, at most 4 MiB, as strict UTF-8 JSON. Only
the three shown options are accepted. There are no network, credential, writer,
clock, history-mode or freshness-policy override options. Audit time is the actual
current clock; injected API time exists for tests only. Exit 0 means VERIFIED
within this narrow scope; HOLD/errors exit 1. No production action is authorized.

## Gates and output

The existing status mirror audit independently checks manifest/latest-attempt
alignment, original snapshot metadata, payload SHA-256, schema, governance and
30-minute freshness. A failed latest attempt cannot be replaced by an older success.

The research audit checks the exact Phase140.31 schema, selected venue/date/source,
null prediction/source times, unknown source-timing declaration, research flags,
race identity/order, duplicate horses, finite unscaled scores, ranks, TIME shape,
null probability/marks/market/EV/diamond/warning, and exact projected counts. Scores
above 100 remain legitimate saved research values, never probabilities. Raw
History/Pack or additional contract fields fail closed rather than being copied.

There must be exactly one canonical research manifest entry and exactly the expected
race-file set. Every race JSON must deeply equal its day-race projection with
identical metadata/hash/capture time. Status race IDs and horse/ability/TIME counts
must match the selected venue; other venues in status do not form a denominator.
No counts are manufactured for missing fields. Reported missing TIME is for all
saved runners, not an inferred active-only measure. Reports omit horse names and
arbitrary source text, exposing only fixed labels, counts and race IDs.

Future timestamps hold. Research and status capture ages are evaluated independently
using the original inclusive 30-minute boundary. Freshness failures retain validated
counts and original timestamps but return HOLD and `currentStatusEligible:false`.
Structural failures expose no unverified totals. No timestamp is relabeled or
backdated. A fresh status cannot refresh old research files, or vice versa.

## What VERIFIED does not prove

`consistencyStatus:CROSS_FILE_CONSISTENT` only proves the supplied files agree under
this contract. Research `sourcePayloadSha256` describes the full viewer payload,
which the projection intentionally omits. Its format and equality across files are
checked, but that hash cannot be recomputed here. Matching edits to both day and
race files could therefore remain consistent. Tests explicitly preserve this limit;
the output says `NOT_RECOMPUTABLE_FROM_PROJECTED_FILES`. Status payload SHA checking
is a different, actually recomputable check. Do not conflate these hashes.

The commit is declared, origin is unauthenticated by the offline API, source
acquisition/Freeze times remain unavailable and EARLY freeze is NOT_VERIFIED.
VERIFIED never certifies full D1 DATA, History/Pack, original acquisition, complete
meeting coverage, EARLY prediction or formal KPI eligibility. Readiness remains
HOLD, Probability MODEL_HOLD and Production Activation NO-GO in every outcome.

## Real-data verification

The latest observed main was `550a1bf3a0ded51311393b83ab0657778a9d64b0`.
Scheduled publisher run 38906383165 started at 22:14:51 JST on 2026-10-16 and
succeeded. Fixed `chass-data` commit `abcff746ffdc709e0b2192931dacf30988fca770`
contains a research capture at 22:15:05.561 JST. This proves that scheduled run,
not uninterrupted recurring freshness. The real bundle must be audited against the
actual clock; once older than 30 minutes it must HOLD rather than be relabeled fresh.

Tests cover independent stale gates, the inclusive boundary, future times, status
hash/attempt failures, schema/identity/count/signal mismatches, file/manifest
ambiguity, missing fields, CLI bounds and the non-recomputable viewer-hash limit.
Run the repository full check as well. Two pre-existing local browser tests need
Chrome; the Bridge full regression must pass before merge GO.
