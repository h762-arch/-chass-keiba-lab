# CHASS KEIBA LAB Ver.10.0.1 Day Public API

## Added endpoint

`GET /api/chass/v1/public/day`

ChatGPT line-oriented endpoint:

`GET /api/chass/v1/public/day-ai`

Required parameters:

- `date=YYYY-MM-DD`
- `track=<track name or supported alias>`

Optional parameters:

- `organization=JRA|NAR`
- `format=compact|full` (`compact` is the default)

Example:

`/api/chass/v1/public/day?date=2026-09-08&track=大井&organization=NAR`

## Behavior

- Returns up to 12 saved Prediction Snapshots for one date and track.
- Sorts races by race number.
- Returns multiline, indented JSON so AI and line-oriented text readers can expand the response body.
- `day-ai` returns multiline JSON by default; `format=text` preserves the line-oriented compatibility format.
- Missing/zero odds, popularity and expected value are serialized as `null`, never as a fabricated zero.
- With saved odds, `day-ai` derives popularity, `expectedValue = winProb × odds`, `expectedValuePercent`, `evRank`, and `abilityPopularityGap` for the response only.
- Race summaries include ability/EV Top3, saved diamond/warning horses, saved volatility, response-only race value score, and favorite reliability.
- Public API remains D1 snapshot-only: it performs no external odds fetch, prediction recalculation, signal invention, or D1 write.
- Reads saved D1 data only.
- Performs no external race fetch, prediction calculation, or D1 write.
- Returns 400 for a missing/invalid date or track.
- Returns 404 when no saved prediction exists.
- Retains GET/HEAD/OPTIONS-only behavior and the existing response whitelist.
- Uses 30-second cache while results are incomplete and 1-hour cache after every returned race has a result.

## Compatibility

Existing `health`, `latest`, `recent`, `races`, `race`, and `result` endpoints are unchanged.

## Verification

- Focused Public API tests: 13/13 passed.
- Full syntax and regression check: 288/288 passed, 0 failed.
