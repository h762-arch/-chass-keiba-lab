# CHASS ↔ ChatGPT GitHub Mirror v1

## Purpose

Make CHASS app data reliably readable by ChatGPT without copying day data into Google Drive and without depending on direct `workers.dev` access from ChatGPT.

## Architecture

1. CHASS Cloudflare D1 remains the authoritative app data source.
2. Existing public read-only APIs are queried by GitHub Actions.
3. GitHub Actions writes only machine-generated snapshots to a dedicated `chass-data` branch.
4. ChatGPT reads `chass-data/manifest.json`, then `day.json` or a single `race-XX.json` through the GitHub connector.
5. Google Drive remains for index sheets, long-term research, validation, and archives.
6. The existing MCP / AI Data Bridge remains the future lowest-latency direct integration path; this mirror is the reliable current fallback/read layer.

## Why a dedicated data branch

- No automated data commit touches `main`.
- No daily PR spam.
- Snapshot refreshes do not deploy the production Worker.
- ChatGPT can read a stable GitHub ref directly.
- Historical snapshots remain easy to inspect by date and track.

## Files in this package

- `publish-chass-chat-snapshot.mjs` — combines ability snapshot + day-ai text into ChatGPT-friendly JSON.
- `.github/workflows/publish-chass-chat-mirror.yml` — auto refresh every 15 minutes from 08:00 to 22:45 JST plus manual refresh.
- `tests/chass-chat-snapshot.test.mjs` — identity/freshness/fail-closed tests.

## Output layout on `chass-data`

```text
manifest.json
chat-snapshot/
  2026-09-15/
    ooi/
      day.json
      race-01.json
      ...
      race-12.json
```

## Safety properties

- D1 read-only: no mutation.
- Existing AI probability / TIME / signal generation is not changed.
- Market data is merged only when horse number + normalized horse name agree.
- Identity mismatch fails closed for market fields.
- If day-ai market data is unavailable, ability data is still mirrored with `abilityOnlyFallback: true`; no odds/EV/💎/⚠️ are invented.
- No volatile fetch timestamp is written, so unchanged source data produces no commit.
- `main` direct push: never.

## Installation

Add the three files to a feature branch based on current `main`, run `npm run check`, then merge via PR. The first successful workflow run creates the `chass-data` branch automatically.

Recommended PR title:

`feat(ai-link): add automatic CHASS ChatGPT mirror`

After merge, run `Publish CHASS Chat Mirror v1` once with:

- date: blank (today JST)
- track_slug: `ooi` for a quick proof, or `all`

Then confirm the new branch contains `manifest.json` and the expected snapshot files.
