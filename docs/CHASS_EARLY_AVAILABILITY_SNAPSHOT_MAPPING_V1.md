# EARLY v2.8.3 Snapshot Mapping and opt-in research runtime connection

Base: 72c76fa006adec0224913deb24c148e845c16fe3 (PR #246).

## Located paths and scope

The app's `acquireNarEarlyResearchRecord` performs one bounded NAR race fetch,
then `buildNarEarlyResearchRecord` -> `makeSnapshot` constructs prediction,
market and final snapshots. `captureNarEarlyResearch` already calls that hook
and then `saveNarEarly` -> `freezeNarEarlySnapshot` -> insert-if-absent/readback.
The new opt-in check runs after acquisition/Final ranking and before this save.
It never replaces the existing seal, freshness, pre-post or immutable-first-save
checks. Existing stored EARLY is selected before acquiring or reassessing.

The JRA background precompute runner produces SOURCE/DATA only and explicitly
does not produce FINAL. It cannot run a Final5 gate at that calculation point.
The mapping API supports a completed five-layer snapshot, but this patch does
not add a JRA finalization scheduler, a production save route or UI activation.

## Mapping contract

`buildEarlyPrefreezeAvailabilityInput(snapshotJson, contextJson)` accepts bounded
JSON text and returns `{status, input, mappingReasons, availability, ...}`.
`status:MAPPED` means projection succeeded, not prediction or formal success;
the caller must inspect `availability.predictionReadiness`.

| Gate input | App record | Five-layer snapshot |
| --- | --- | --- |
| race identity | predictionSnapshot.raceId + race | root raceId + SOURCE.race |
| startAt | raceDate + postTime, explicit JST | SOURCE.race date/postTime, JST |
| freezeAt | explicit context.freezeAt | explicit context.freezeAt |
| coverage | explicit context.expectedRunnerCount | explicit context.expectedRunnerCount |
| runners | predictionSnapshot.horses | SOURCE.horses, exact DATA.horses roster match |
| source time/ref | per-horse fields or matching common receipt | same |
| Final5 | finalSnapshot.final5 or ordered ranking positions 1..5 | FINAL.final5 or ordered ranking positions 1..5 |
| CPSI | predictionSnapshot.cpsi/cpsiCompat, scalar allowlist | DATA.cpsi/cpsiCompat, scalar allowlist |
| persistence | explicit context.persistenceDeclarations only | same |
| RESULT | never copied; presence rejects via boolean | same, including layers.RESULT |

No source time comes from generatedAt, savedAt, validatedAt or the current clock.
A common receipt must explicitly say scope:ALL_RUNNERS, carry the same raceId,
exactly match unique horse numbers and supply capturedAt/sourceRef. An existing
source-level acquisition time must agree. Invalid explicit horse-level values
are not repaired by the receipt. Missing evidence holds, rather than fabricating
per-horse acquisition events. The shared value means one whole-card observation.

Prediction, final and available market timestamps must exist and be at/before
cutoff. SOURCE cannot postdate prediction; FINAL cannot predate prediction.
The runtime additionally checks cutoff <= its existing completion clock. The
existing save guard independently requires actual capture completion pre-start.
This does not authenticate a receipt or prove the current race is live.

No mark, warning, diamond, probability, EV or ranking is recalculated. Selecting
the first five existing ranked entries is a candidate gate input; it does not
invent missing five-symbol Original Signals. If only top3 exists, HOLD.
Contradictory explicit Final5/ranking, race identities and roster coverage hold.

## Explicit research invocation

```js
const result = await captureNarEarlyResearch({
  enabled: true,
  store, raceId, clock,
  acquire: args => appCore.acquireNarEarlyResearchRecord({...args, enabled:true}),
  availabilityJson: JSON.stringify({
    freezeAt: declaredPreStartCutoff,
    expectedRunnerCount: discoveredCoverageCount
  })
});
```

The app acquisition hook now returns common receipt metadata based on its actual
requested URL, received whole-card horse list and server acquiredAt. These are
local declarations, not independent proof of official origin. The runtime does
not let availabilityJson override this receipt. No caller is enabled by default;
omitting availabilityJson preserves the previous research capture contract.
FULL/DEGRADED may proceed only to the existing research save checks; HOLD stops
before insertion. The assessment itself never authorizes a production freeze.

## Verification and remaining work

Tests use actual repository snapshot construction and app fetch/build/snapshot
functions with synthetic payloads and an isolated memory store. They cover
FULL/DEGRADED/HOLD, exact common receipt binding, temporal and coverage failures,
RESULT exclusion, no state changes, first-version preservation and original seal
enforcement after a DEGRADED assessment. These are code-path tests, not a live
official acquisition test or evidence of resolving an unseen operational error.

Next: run the opt-in path against an actual pre-start snapshot and its genuine
cutoff/coverage receipt, inspect the reasons, and perform a pre-race dry run.
Operational error logs can add a regression fixture when available; they are
not a prerequisite for implementing this mapping.

Formal KPI HOLD; Probability MODEL_HOLD; Production Activation NO-GO.
No production D1 writes, workflow changes or deployment are performed here.
