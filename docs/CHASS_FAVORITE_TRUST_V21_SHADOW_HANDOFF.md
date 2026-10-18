# CHASS Favorite Trust & Collapse v2.1.1 reviewed Shadow handoff

> 2026-10-18 hypothesis-stage research implementation. **Not Production.**
> Based on 10/18 result failures; retrospective replay is in-sample and is not validation.
> Reviewed against main `9bf29143f79d53c79b26d2e501fd8819e9c77bec`, source tree `39e3979dd621f3da65750ae22114f37e5f8ea758`.
> This is an additive research module. It is **not connected to app.js**, official signals or storage.

## Source authority and scope

- Research governance: https://docs.google.com/document/d/10J74V8oNcA9v8hvMqtAKCwZGy25vCO66JNcQcrkyAnw/edit
- Favorite v2.0 baseline: https://docs.google.com/document/d/1Yv-8_igHtsPossSTXL0w-HcAoVbevN3Vp0pI27YE_0s/edit
- Pre-result candidate freeze: https://docs.google.com/document/d/1f0J2Zq9wyRNdDoJSBrI_fFw3Xu252H0yF0Rn_xTIwGg/edit
- CPSI authority: https://docs.google.com/document/d/1ACIlygzu-ibx6y6kMKCl3-Y-Vgr7KRZ-w2g1ZVK-seE/edit
- These links were supplied in the original handoff. This review did not read or update those Drive documents and does not certify their current content or saved state.
- The only **ability index** accepted for decisions is CPSI. Raw legacy index components are only internal CPSI materialization inputs of the existing authority, not independent alternatives. This module does not calculate CPSI.
- For now JRA/NAR need different prospective validations. Newcomer/jump need specialty paths.

## Why v2.1

The previously evaluated 10/18 JRA reference Favorite sample counted 30 runners, 5 wins, 26 Top3, high-trust 11/12 Top3, low-trust 6/8 Top3. All three v2.0 Shadow caution flags finished Top3. This is not proof of general predictive performance: it's the **error discovery** sample. Its post-result data must never enter Original EARLY input.

These numbers and the four examples below are **unverified handoff reference claims**. No authenticated EARLY ledger, official result join or betting ledger was supplied to reproduce them. They are not this patch's validation results.

- Kyoto 8 #5: promotion/first-distance risk overcounted; ⚠️ finished 1st.
- Niigata 3 #7: two-year-old low-sample uncertainty overcounted; ⚠️ finished 2nd.
- Niigata 6 #1: fewer than three simultaneously viable seat-displacers; ⚠️⚠️ finished 3rd.
- Tokyo 8 #2: favorable CPSI and past exact performance did not prevent pace-collapse, ★★★★☆ finished 16th.

## Implemented in this patch

- Pure side-effect-free ESM function `evaluateFavoriteV21Shadow(input)`.
- Caller metadata consistency checks and explicit result/late-field rejection; no acquisition or source authentication. No results, late market, mutation, production storage, Wave, AI probabilities or Formal⚠️ changes.
- Each independent negative causal family counts once. Index/CPSI primitives do not count as independent families; pace and position overlap.
- Newbie, few starts, unknown distance/class are not hard observed negatives.
- Requires **three individually named, distinct, credible challengers in one pre-frozen common scenario** for caution candidates, with two distinct support families and a non-ability family for each challenger. Never add challengers across incompatible scenarios.
- No caution if survival or rescue evidence remains unresolved for the would-be collapse scenario.
- Stronger ⚠️⚠️ and ⚠️⚠️⚠️ require multiple common scenarios and additional negatives.
- Independent `paceStressWatch` persists even when Original EARLY marks block formal caution.
- No real-world source authentication or CPSI generation is claimed; this is a gating decision over **caller-supplied** data.

## Review corrections and input migration

The supplied v2.1 passed its 23 unit tests but additional synthetic probes reproduced:

1. Invented negative families counted as independent causes.
2. Different horse numbers with the same horseKey counted as three horses.
3. A Tokyo race labelled NAR was accepted.
4. Invalid CPSI coverage/neutralization percentages were accepted.

v2.1.1 rejects those cases. Unknown families cannot enter the count. Pace and position remain one family; ability, index, peak and average cannot supply independent observed negatives. A challenger now needs **numeric CPSI plus an independent non-ability route**, rather than two arbitrary family names. Numeric CPSI requires a valid rank, field size, pre-result/market-blind flags and authority; neutralization disclosure is required for a warning candidate. Core count is 0–3 for the existing CPSI A/B/C core groups (`src/prediction/chass-cpsi-wave-core-v1.mjs`); core count is not the seven-primitive count. Coverage, when supplied, must be 0–100; missing coverage is disclosed as null, never invented.

The safe data copier checks own descriptors on arrays as well as objects. It rejects getters without executing them, holes, custom array keys/prototypes, symbol/hidden properties, cycles and nonfinite numbers. This is a plain JSON-like data contract; it is not an in-process security boundary against hostile JavaScript Proxies.

### Root contract

Existing required fields are retained. `recentStarts` is now an explicit nonnegative integer; mark and booleans are strict; survival/rescue lists must be explicitly provided. Empty counter-evidence lists are a **caller claim of completed review**, not proof that no rescue exists.

`evidenceContext` is added. Missing context produces `WATCH_RECHECK`; mismatched context is rejected:

```js
{
  raceId, circuit, earlySnapshotId, // exact root match
  runId, inputFreezeId, sourceId,  // nonempty trace identifiers
  sourceAt, freezeAt, scheduledStartAt, // canonical UTC ISO, millisecond precision
  population: 'FLAT', // NEWCOMER/JUMP/BANEI are specialty routes; no warning here
  runners: [{horseNo, horseKey}, /* complete unique declared field */]
}
```

The declared times must satisfy sourceAt <= freezeAt < scheduledStartAt, and start's JST date must match raceId. This module has no clock, fetch, signature verification, registry or persistence. It **does not prove that the run was before the actual start**, that a cancellation was reflected, or that all entries belong to one authentic acquisition. The caller must produce the entire case from the authenticated same-run/freeze ledger. Reusing or backdating a caller case does not become prospective validation just because it passes these checks. JRA/NAR venue identity and calendar/race number are validated; JRA and NAR performance cohorts remain separate. Specialty populations are excluded until their own path is implemented.

Each challenger retains its existing fields and adds `cpsi`, using the same CPSI schema as the favorite. horseNo and horseKey must match the unique declared roster. eligibleHorses is the common numeric CPSI rank cohort, which may be smaller than the complete field; it must not exceed the roster size and challenger/favorite cohorts must agree. Missing challenger CPSI makes it noncredible rather than inventing ability. Challenger sources/routes are part of the declared common frozen case; per-record origin/timestamps still need external ledger verification.

`jointSeatProofs` is added (maximum one per scenario):

```js
[{scenario: 'FAVORITE_HOSTILE', horseNos: [2,3,4],
  routeSourceIds: ['evidence-2','evidence-3','evidence-4'],
  compatible: true, sourceId: 'joint-evidence-id',
  displacementDescription: 'Explain the concrete common scenario in which these three occupy Top3 and the favorite finishes fourth or worse.'}]
```

All three named routes must be credible in that same scenario and match their source IDs. Missing joint proof, incompatible routes or unmatched sources produce review-only WATCH. The compatibility flag and description are caller assertions, not a causal simulation or independently verified proof. No addition to Final5, mark promotion or probability change follows from these labels.

### Output and limits

- ⚠️ candidates are limited to EARLY popularity 1–3, with all five formal marks excluding them. Popularity, low EV, raw ability, low sample or UNKNOWN alone cannot produce ⚠️.
- `sourceOriginAuthenticated:false`, `liveAcquisitionVerified:false`, `evidenceBasis:CALLER_ASSERTED_METADATA_ONLY` remain explicit even for a Shadow candidate.
- `winAssessment:NOT_IMPLEMENTED` and `top3Assessment:SCENARIO_REVIEW_ONLY` prevent this gate from being described as a completed win-versus-place model. No win probability or improvement estimate is implemented.
- Caller direct-negative/source assertions and omitted counter-evidence cannot be authenticated here. A complete unit-test fixture is not fresh acquisition, a live smoke result or predictive validation.
- On a rejected input, the caller must fail closed in its separate research ledger; do not repair or fall back to synthetic inputs during a live run. No app caller is added by this patch.
- Existing strengths, CPSI weights, formal ⚠️/💎 rules and Original EARLY are untouched. No measured accuracy/ROI improvement or resolution of the earlier NAR live error is claimed.

## Invocation and validation

```js
import {evaluateFavoriteV21Shadow} from './src/prediction/chass-favorite-trust-v21-shadow.mjs';
const result = evaluateFavoriteV21Shadow(preFrozenCase);
// result.warningAuthority === 'SHADOW_ONLY'; label is only a candidate/review label.
```

```sh
node --test tests/chass-favorite-trust-v21-shadow.test.mjs
npm run check
```

## Forward-only promotion plan

1. Produce the `preFrozenCase` from authenticated same-Run, same-Cutoff Original EARLY evidence. Include CPSI coverage, uncertainty, actual proof of three challengers and scenario stamps in the caller ledger. The present module does not authenticate source origin.
2. Run v2.0 versus v2.1 concurrently from identical early snapshots, freeze both before results, and store results in a separate POST artifact.
3. At 50 unseen normal flat JRA races perform an interim audit; target 100+ with enough both caution and collapse events for any promotion claim. NAR must be separate.
4. Compare caution precision / false-warning rate **and** missed-collapse recall, high-trust Top3 preservation, Win/Place head-vs-survival separation and data coverage. Report count/intervals. Prevent WATCH inflation.
5. Current Canonical pointer, Original EARLY, formal model, probability, CPSI weights, Wave coefficients and Production are unchanged. `MODEL_HOLD` / Formal KPI HOLD / Production NO-GO remain until independent governance approval.

No 50/100-race result exists in this handoff; those are research targets, not sample-size guarantees. Freeze the reviewed schema and hypotheses before unseen evaluation, report WATCH/missingness separately, and distinguish false-warning reduction from merely abstaining more often. Win selection remains a separate unimplemented hypothesis, not a new scoring formula in this patch.

## Bridge boundaries

This patch adds **exactly three new files**, nothing else. `CHASS Patch PR Bridge v1` must check the exact allowlist and full `npm run check`. No main write, no release, no Cloudflare deploy, no D1 migrations, no Workflow changes.
