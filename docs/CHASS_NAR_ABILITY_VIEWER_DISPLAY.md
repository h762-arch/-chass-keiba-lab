# Phase128: render NAR research ability scores and ranks

## Observed production gap

On 2026-10-13, the dated Kawasaki canary stored three races (7/8/9R) after the
11:10 Cron and six races (1/2/3/7/8/9R) after the 11:15 Cron. The read-only
status API reported rejectedRowCount=0. Official RaceList identified 12 races;
full-day completion was still unverified at this audit.

The production Viewer rendered those race names, horses and TIME values, but
the desktop table had no ability-score/rank columns. Mobile reused formal
prediction cards, exposing empty probability/market fields. The source API
already provided abilityScore and abilityRank, so this was a presentation gap,
not a reason to synthesize probabilities.

## Change

Only day.viewerMode === nar-precomputed-ability-research selects the new view.
Desktop shows horse number/name, ability score/rank, TIME and runner status.
Mobile uses compact per-horse readouts with the same fields and a research-only
note. The formal mark legend is hidden for this mode. JRA and legacy NAR
presentation remain on the existing path.

No probability, mark, market, EV, diamond or warning is generated. No API,
D1, Cron, canary date, stop time or runtime flag changes are included. Unknown
scores/ranks/states and missing TIME retain explicit labels. Output uses text
nodes, never source HTML. Source horse arrays and original forecasts are not
mutated.

## Verification

Five new tests cover field projection, missing/inactive state labels, escaped
text/no mutation, exact-mode routing and Chrome phone-viewport rendering.
Full repository check: 1,792/1,792 PASS. The browser regression uses synthetic
NAR data. Live production inspection verified the older Viewer mismatch;
this corrected UI still requires Bridge/CI/merge/deploy before live confirmation.

This patch does not claim completion of all 12 Kawasaki races or formal EARLY
eligibility. The Phase127 new-work cutoff remains 14:55 JST today, and saved
research rows remain readable after expiry.
