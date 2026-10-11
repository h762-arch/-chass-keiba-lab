# JRA official card → app prediction repair (Phase114)

## Problem and behavior

The public race endpoint returns a nested `race` object. The browser app
previously compared missing top-level `date` / `track` and `Number(data.race)`
against the selection. It returned `false` before normalization, while the
client still displayed prediction completion and emitted the race-ready event.

`commitJraOfficial` now checks organization and the exact nested
`race.date` / `race.racecourse` / `race.raceNo` against the selection. Active
race identity is checked using that same nested identity. Existing generation,
normalization and cancellation gates remain in place.

A rejected commit now reports `JRA_RACE_COMMIT_REJECTED` and cannot emit the
race-ready event. The status is outside the manual fallback disclosure so both
success and errors are visible without opening manual input.

## Validation

Seven regression cases cover nested official identity, expired saved official
base, wrong identity or organization, stale generation / NAR mode, cancelled
runners, rejected commit notification and successful race-ready notification.
Calculation checks use the real normalizer, model and adapter.

The existing Chromium smoke test now loads a saved official card through the
actual app handler and requires all horse names and comparison rows to render.
Its race response uses the existing official parser fixture and saved-cache
projection; it is synthetic and does not establish live-day coverage.
It polls real browser completion over the DevTools pipe using wall-clock time.
The earlier virtual-time probe could expire while IndexedDB initialization was
still pending. Other API calls are explicitly offline in this fixture test;
browser IndexedDB and the actual DOM rendering path remain enabled.

## Limits and release checks

No Worker, scheduling budgets, precompute readers, formal KPI contracts,
prediction weights or Signal Freeze rules change. Saved official base retains
its existing live-fields-unconfirmed contract.

Require the complete Bridge check, including Chromium, before merging. After
deployment verify Tokyo/Kyoto selection, visible status, actual horse rows and
AI probabilities. A passing retrieval status alone is insufficient.

This patch repairs the existing browser prediction path. It does not establish
that the browser consumes the formally frozen precomputed DATA/MARKET/Signal
snapshot, or authorize Production Activation.
