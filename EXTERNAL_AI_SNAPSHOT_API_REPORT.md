# CHASS External AI Snapshot API

## Added endpoint

`/api/chass/v1/public/ai-snapshot/YYYY-MM-DD/{track-slug}.json`

Example:

`/api/chass/v1/public/ai-snapshot/2026-09-09/kawasaki.json`

The endpoint resolves the date and ASCII track slug from the URL path and uses the existing ability compact D1 read, latest-official-snapshot dedupe, partial-race isolation, and serializers. It does not calculate ability values again, fetch external data, read market snapshots, or write to D1.

## HTTP contract

- Methods: `GET`, `HEAD`, `OPTIONS`
- Other methods: `405`
- Content type: `application/json; charset=utf-8`
- Cache control: `public, max-age=60, s-maxage=120, stale-while-revalidate=60`
- Stable `ETag` based on the ability snapshot payload
- `Last-Modified` based on the newest selected D1 prediction/update timestamp
- `X-CHASS-Response-Bytes` reports the exact UTF-8 response size
- Conditional `If-None-Match` requests return `304`
- Invalid date or unsupported/non-ASCII slug: `400`
- No saved prediction data: `404`

## Schema and responsibility

The response remains `ability-compact-v1`, `evaluationMode: "ability-only"`, and `marketEvaluation: "external"`. Horse objects use the same serializer as `day-ai?format=compact`. Market fields such as odds, popularity, EV, diamond, and warning are not returned.

## Local verification

- Full regression: 319 tests passed, 0 failed
- Snapshot focused test: three consecutive GET requests returned HTTP 200
- Fixture response: 12 races, 24 horses, 7,975 bytes
- Fixture processing: 1 ms cold, 1 ms warm in the focused run
- Three unchanged responses had identical body and ETag
- HEAD returned no body with matching ETag and byte count
- Snapshot races matched `day-ai compact` races exactly
- D1 writes: 0

The production Worker was not deployed from this workspace. The live 2026-09-09 Kawasaki expectation of 12 races and 151 horses must be confirmed after deployment. A fixed path and cacheable response can improve compatibility with external fetch systems, but cannot guarantee elimination of a ChatGPT-side cache miss.
