# Phase140.4: retained TIME and identity matching condition audits

Base: main 38444b8d6023e831c8f78138ff3a81392b90a14c (PR #206).

## Confirmed code contracts

worker.js predictTimeFromRuns first selects finite timeSec at exact numeric
r.distance===targetDistance (up to three). If absent, it uses finite timeSec
and a distance difference <=300m (up to three), with linear normalization.
Consequently sameDistanceCount=0 alone cannot establish a missing TIME cause.
classifyPredictedTimeMissing returns time_missing_unknown for remaining cases
with numeric TIME where predictTimeFromRuns produces no output. enrichAbility
calls this classifier without a targetSurface argument. No predictor, classifier,
parser or surface policy is changed here.

The identity bridge uses originCircuit===NAR, exact MM.DD equality against
ref.date.slice(5), and exact venue-name equality against its code table. A unique
candidate and unique observed month/day+venue episode are required. The bridge
compares month/day, not full dates; retained card facts still have unresolved
years. Diagnostics do not infer a year or canonical identity. Unknown/missing
source and parser facts are not repaired.

## Optional output

The existing diagnostics=1 status sidecar adds `conditions` to each diagnostic
horse: `{time, history}`. Original time, history, sourceReason, observations and
counts are unchanged. Existing sidecar OBSERVED means the original projection
is available; inspect each conditions section's status separately.
Normal status, Viewer, DATA, Pack, hashes, writer, schema, model, flags, limits,
acquisition window and original Signals are unchanged. There are no extra D1
queries or external fetches. The two new helpers are pure and catch their own
exceptions. Phase140.3's post-restoration failure boundary stays intact.

TIME conditions apply only to MISSING horses:

- Observed target distance, retained/parsed counts and coverageComplete.
- Finite numeric TIME count; exact and within-300m candidate counts (overlap
  deliberately includes exact in the within-300m count, never add these counts).
- Invalid distance and nonpositive numeric TIME counts.
- Complete history requires parsedCount=retainedCount=episodes.length and
  agreement with retained evidence.runCount; otherwise coverage is incomplete.
- A complete retained history with no eligible distance shows
  NO_FINITE_TIME_WITHIN_300M. Candidate presence, absent TIME, invalid distances
  and nonpositive TIME are separate observations. No predicted value is computed.
- These describe retained observations. They do not establish all upstream
  parser facts, complete career history or a historical causal trace.

History conditions apply only to horses with observed HOLD references:

- Bind each retained reference by observationKey AND contentHash to one episode.
- Select the existing exact horseNo/horseName row; no fuzzy joins.
- Report bounded origin category, supported month/day/venue flags, official
  reference count, month/day/venue/combined candidate counts, NAR-eligible count
  and duplicate month/day+venue episode count.
- Report ORIGIN_NOT_NAR, DATE_TEXT_UNSUPPORTED, VENUE_NOT_RECOGNIZED,
  NO_OFFICIAL_PAST_REFERENCES, NO_MONTH_DAY_MATCH, NO_VENUE_MATCH,
  DATE_VENUE_COMBINATION_UNMATCHED, MULTIPLE_CANDIDATES_OR_EPISODES or
  MATCHING_CANDIDATE_PRESENT. The last never promotes a stored HOLD.
- Retained keys/hashes, names, raw dates, arbitrary origins, URLs and error text
  are not copied. Data bounds: five episodes/references and thirty link rows.
- Unsupported/absent inputs are UNAVAILABLE, not zero. NOT_APPLICABLE does not
  certify complete History and does not erase existing unavailable statuses.

## Production evidence supplied before this patch

User's Phase140.3 JSON: 12 saved, 0 rejected; diagnostic status OBSERVED.
Nine TIME missing horses all had sameDistanceCount=0 and 3-4 parsed histories.
All 32 identity HOLD references across 12 horses were EPISODE_LINK_UNMATCHED,
EPISODE_AMBIGUOUS=0; no overlap with the nine TIME missing horses.
The new condition details were NOT present; production classification awaits
merge/deploy and user-provided diagnostics=1 response. No production DATA was
fetched or changed by this patch. Source 404 root cause remains unconfirmed;
no acquisition route or retry changes are included.

## Verification and next step

Unit cases compare TIME candidate predicates against the existing predictor at
exact/300m boundaries and show why no exact distance alone is insufficient.
Additional cases cover truncated/legacy coverage, invalid or absent facts,
nonpositive TIME, foreign origins, date/venue/combined mismatch, duplicate
candidates, unresolved references, bounds, frozen inputs, leakage and exceptions.
The saved-DATA integration uses the real runner, identity/hash verification,
status and Viewer with synthetic fixtures; it preserves all row bytes and
unknown original reasons. A twelve-race regression retains saved=12/rejected=0.

After Bridge CI and independent review, merge via the normal manual workflow.
Confirm Workers build, then re-open the existing date=2026-10-15&diagnostics=1
status. Preserve 12/0; inspect conditions for only the nine TIME horses and twelve
History-HOLD horses. Do not widen distance limits, infer missing years, rewrite
saved TIME/identities or connect Probability from diagnostic observations.

## Local results (2026-10-15 JST)

- New Phase140.4 tests: 20 PASS (18 unit + 2 saved-DATA/readback regressions).
- Related seven-file suite: 127 PASS, 0 fail.
- Full npm run check: 1935 total / 1933 PASS / 2 FAIL.
- The remaining failures require Chrome: jra-browser-smoke and
  viewer-nar-ability-browser. Full local check is NOT PASS; Bridge CI pending.
- New/changed runtime modules: node --check PASS; git diff --check PASS.
- Local MCP dependency symlink removed before packaging; no lockfile changes.
- No production diagnostic classification, migration, write, merge or deploy
  performed during patch preparation. Production 404 root cause still unknown.
