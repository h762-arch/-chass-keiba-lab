# Phase129: bounded daily NAR ability trial

Phase128 production verification on 2026-10-13 confirmed Kawasaki 12/12 persisted research races and public ability/rank/TIME rendering without opening the prediction app. This is ability DATA coverage, not formal EARLY/Signal completion.

## Runtime change

- Explicit `NAR_PRECOMPUTE_RUN_MODE=daily`; absent mode retains the one-day canary contract.
- Kawasaki only (`21`), from 2026-10-14 through 2026-10-20 inclusive.
- Each day uses its actual JST date, starts at 07:00 and stops at 14:55 JST (exclusive).
- A daily range must contain at most seven dates. Invalid, missing, reversed or overnight windows fail closed before schema/discovery work.
- The existing five-minute Cron, NAR three-attempt cap and 20-second budget remain unchanged. Busy auto-result runs retain priority. JRA job/planning caps remain 1/4.
- Confirmed non-meeting days enqueue nothing. No synthetic dates, cards or ability values are introduced.
- A race must still have a verified post time and be acquired/saved before its own start. Daily stop and execution deadline are also rechecked before save starts.
- Existing immutable revisions are preserved; a new date gets distinct race identities. Already-started SQL cannot be cancelled at a wall-clock boundary.

## Read-only monitoring

`/api/chass/v1/public/nar-precompute-status?date=YYYY-MM-DD` now includes schedule mode/status/reason and daily range/time settings. `active` describes the requested current JST date's scheduling window, not official meeting presence or guaranteed Cron execution. The saved count remains validated persisted coverage, not a proof that every horse has ability or TIME. Reads remain available outside the trial window.

## Limits and follow-up

Only research ability/rank and existing TIME are connected. No win/place probability, EV, market, marks, diamonds, warnings, formal KPI or Signal Freeze is added. No other venue is enabled.

This patch replaces today's canary acquisition configuration with a future seven-day daily trial. Today's already-saved rows remain readable. PR merge/deployment is required before daily acquisition can run. No deploy or production D1 changes were executed while preparing the patch.

Next live checks: deployed configuration, confirmed meeting/non-meeting reason, next meeting's saved race coverage without app usage, repeat-run preservation, daily cutoff and final-date expiry. Future official meetings and full coverage are not claimed by synthetic tests. Extend dates or venues only through a separately reviewed configuration change.
