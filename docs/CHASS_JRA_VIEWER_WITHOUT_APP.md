# JRA viewer without opening the prediction app

Phase116 enables the existing read-only JRA precomputed viewer route through
`ENABLE_PRECOMPUTED_VIEWER=true`. JRA `/public/races`, `/public/day` and
`/public/race` now read `precomputed_race_snapshots` rather than app-saved `races`.
The viewer can discover courses and display each race with saved EARLY DATA
even when the main prediction app has never opened that race.

This route exposes ability marks, scores, win/place probabilities and TIME.
It intentionally does not join MARKET or expose odds, EV, diamonds or warnings;
the viewer states this explicitly. Existing app-saved market signals are not
the formal precomputed DATA. This is a viewer rollout, not Signal/KPI approval.

The existing earliest DATA revision, identity/version checks, fail-closed
behavior and prohibition on market overlays remain in force. No read triggers
prediction, official acquisition, D1 writes or schema creation. Missing DATA
stays unavailable rather than falling back to app-created predictions.
NAR and `/day-ai` retain their existing routes. DATA scheduling and MARKET
runner limits are unchanged. A server precompute must actually finish before
its race appears; raw official card availability alone is insufficient.

Validation uses synthetic Tokyo/Kyoto 24-race DATA with no app-saved rows,
through the real Worker public API and viewer sanitizer. Production coverage
must be checked after deployment by opening the viewer without creating app
predictions and inspecting date-level race counts and the EARLY notice.
Rollback is `ENABLE_PRECOMPUTED_VIEWER=false`.
