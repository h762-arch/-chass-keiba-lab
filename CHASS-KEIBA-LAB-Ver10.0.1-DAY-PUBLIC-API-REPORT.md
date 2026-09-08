# CHASS KEIBA LAB Ver.10.0.1 Day Public API

## Added endpoint

`GET /api/chass/v1/public/day`

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
