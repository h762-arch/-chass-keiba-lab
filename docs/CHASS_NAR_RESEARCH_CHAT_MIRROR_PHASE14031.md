# Phase140.31 — NAR research mirror after legacy snapshot 404

## Observed routing mismatch

At 2026-10-16 18:27 JST, the legacy Kawasaki
`/api/chass/v1/public/ai-snapshot/2026-10-16/kawasaki.json` returned 404
`RACE_NOT_FOUND`, while the compact NAR status returned 200 with five saved rows.
The research viewer `/api/chass/v1/public/day?date=2026-10-16&track=川崎&organization=NAR`
returned 200 and five races / 55 horses. Its body was 1,242,253 bytes, including
History/Pack details that are unnecessary for a chat ability/TIME readout.

The main code at `41b102082af89b12a4d7b0d2db9a58b791b5e50e` explains the
route difference: the legacy snapshot branch reads `races` through
`publicAbilityMappedRaces`; the NAR viewer and status restore
`precomputed_race_snapshots`. The publisher previously returned missing immediately
on the legacy endpoint's 404 and never tried the research viewer. This establishes
an available alternative read path, not proof that the old `races` table has no
rows, nor the cause of earlier source-fetch failures.

## Behavior

Only after an explicit legacy 404 for one of the 14 supported NAR venues, the
publisher performs exactly one GET against the fixed public NAR JSON day viewer.
Legacy successes and JRA routes retain their behavior. Legacy network errors,
429/5xx and malformed legacy payloads never enable this fallback.

Research viewer reads have a 15-second whole-request deadline (including body
consumption), no redirects/retries and a 4 MiB advertised/streamed byte limit.
The response must be strict UTF-8 JSON with the expected viewer mode, date, track,
organization, disabled market and research governance flags. Race IDs/code/number,
uniqueness, runner identities/status, count bounds, ability aliases, ranks, TIME
shape and null probability/market/marks are validated. Scores are finite saved
research values, not percentages: real scores 100.5 and 103 must not be clamped to
100 or interpreted as probability. Incompatible/unsafe data fails closed.

Projection excludes raw History, rolling History, Pack and source evidence. It
retains horse names/numbers, saved ability score/rank, available TIME and runner
status. Missing TIME stays null. Probability, market, EV, marks, diamonds and
warnings remain null. No results, source re-fetch for prediction, training or
EARLY repair occurs.

## Separate contract and storage

- Schema: `chass-nar-research-chat-mirror-v1`
- Day: `chat-snapshot/research-nar/YYYY-MM-DD/<slug>/day.json`
- Race: `chat-snapshot/research-nar/YYYY-MM-DD/<slug>/race-NN.json`
- Scope: `RESEARCH_ABILITY_TIME_ONLY_NOT_EARLY_PREDICTION`

Legacy files are not overwritten. `published`/`missing` continue to describe the
legacy route; `researchPublished` separately lists research output. Thus a result
can truthfully report legacy `missing:["kawasaki"]` and research publication success
at the same time. Both fields must be read. The existing workflow copies all
`chat-snapshot` files and walks all `day.json` files when building its manifest;
no workflow edit is required. Its generic track-file count does not distinguish
legacy and research schemas; consumers must check path/schema and the source file's
research flags, not treat manifest presence or workflow success as formal readiness.

`capturedAt` is the actual viewer-read completion time. The viewer does not expose
source acquisition, data calculation or EARLY freeze timestamps here, so
`sourceAcquiredAt`, `predictionAt` and latest prediction/odds/result times remain
null; capture time never fills them. `sourcePayloadSha256` hashes UTF-8
`JSON.stringify(viewerPayload)` and is not a D1 snapshot/Pack hash or origin proof.
All output remains research-only, formal-KPI ineligible, MODEL_HOLD and activation
NO-GO. It is a saved-data projection, not independent full DATA/History verification,
expected meeting completeness, or a certified EARLY prediction.

## Verification and limits

Tests cover projection/immutability, scores above 100, missing TIME, unsafe signals,
identity/configuration errors, content/UTF-8/size/deadline failures, isolated research
files, legacy/JRA preservation and absence of fallback on network failures.
The local full check has two pre-existing tests requiring Chrome; the Bridge full
regression must pass before merge GO. Runtime, D1, collection conditions and existing
workflows are unchanged. The public endpoints and local output were exercised with
real saved data; GitHub workflow publication of this new research namespace remains
unverified until after merge and a new publisher run.
