# CHASS v2.22.1 CPSI / Wave recovery — reviewed Shadow

This patch replaces the uploaded synthetic-base patch. It is generated against
the real repository at `3f78082005b58195630632ed5bf82e34207252d4` and preserves
the course Shadow modules and their existing public-asset exceptions.

## Formula and authority

- CPSI weights: A/B/C .20 each, D .15, E/F .10 each, G .05.
- A = .55 RR(Peak) + .45 RR(Baseline5).
- B = RR(Current), or explicit RESOLVED_PROXY using Prev.
- C = .50 RR(Distance) + .50 RR(Course). One missing primitive contributes 50
  only inside MainCompat and remains UNKNOWN in `primitiveStatus`.
- RR uses the lower percentile for ties; a single available primitive is
  `SINGLETON_NEUTRAL` with value 50. It is not an observed comparative rank.
- At least two usable A/B/C families are needed for MainCompat and its rank.
- Missing domains contribute compatibility 50 only to MainCompat. ResolvedOnly
  uses strictly RESOLVED domains, excluding proxy, partial and unknown domains.
- NeutralizedWeight includes missing primitives inside a partial C domain.
  With D–G missing and half of C missing, neutralized weight is 50%, partial
  domain weight 20%; these diagnostics intentionally overlap.
- JRA FS/FIM/CD/FW/ENT/MGD, available-weight SC/MC and round(.55 SC+.45 MC)
  retain HARAN-V02-20260927-FROZEN. Missing components are not zeroed.
- NAR accepts its own PRE SC/MC and NAR classes only; it does not derive SC/MC
  using JRA components. No Extreme Recall or candidate-selection policy is added.

Primary contracts read during review:

- https://docs.google.com/document/d/1ACIlygzu-ibx6y6kMKCl3-Y-Vgr7KRZ-w2g1ZVK-seE/edit
- https://docs.google.com/document/d/1AGZDYuAbQj8vt5z680soDpQmrumNEivPhLBWQSmxztk/edit
- https://docs.google.com/document/d/1_fWyxLFj0f1KUSyyTLDq-vr5jAAvzWSR4p7yjxxyaLY/edit
- https://docs.google.com/document/d/1xDiOfii3Ahm1vgkjFH3ahk_7hFq4soIZEgpcPoqveYs/edit

## Explicit input freeze; no inferred authority

The application adapter reads `race.metricInputFreeze`:

```js
{
  runId: 'EXACT_RUN_ID',
  inputSnapshotId: 'EXACT_INPUT_FREEZE_ID',
  indexSnapshotId: 'EXACT_INDEX_SNAPSHOT_ID',
  marketSnapshotId: 'EXACT_MARKET_SNAPSHOT_ID',
  freezeAt: '2026-10-18T09:50:00+09:00',
  postAt: '2026-10-18T10:30:00+09:00'
}
```

These times and IDs are schema examples, not acquisition evidence. The Core
requires valid timezone-qualified ISO times, cutoff <= check time < post time,
and the actual JST race day. Application code uses the real clock; it does not
create freezeAt from save time. An explicit `now` option exists for deterministic
unit/replay diagnostics and must not be treated as live verification.

Race identity is the app's exact `YYYY-MM-DD|venue|raceNo` format, matching
`race.raceDate`, `race.track`, `race.raceNo` and the organization. A different
canonical-ID format needs an upstream mapping; it is not silently accepted.

Every supplied index, market, evidence or domain artifact must carry matching
`organizer`, `raceId`, `runId`, `inputSnapshotId`, `kind:'EARLY'`,
`isPreResult:true`, `capturedAt` and `authorityRef`. Capture time must be on the
same JST race day and no later than the cutoff. Older history is permitted only
as primitives in a newly frozen PRE-built canonical index artifact.

These checks validate caller-supplied metadata and consistency. They do NOT
authenticate Drive provenance or verify a physical acquisition receipt/hash.
The result explicitly has `sourceOriginAuthenticated:false` and
`provenanceBasis:'CALLER_METADATA_VALIDATED_NOT_SOURCE_AUTHENTICATED'`.
The upstream producer and physical readback are still pending; labels alone
must never promote these diagnostics to verified evidence or formal KPI.

## Supported sources

Per-horse `canonicalIndex` carries the shared metadata plus
`sourceClass:'CANONICAL_INDEX_PRE'`, `sourceSnapshotId` matching indexSnapshotId,
and only `peak`, `baseline5`, `current`, `prev`, `distance`, `course` primitives.
Do not put odds, popularity, marketGap, outcome fields or arbitrary columns here.

Alternatively `race.cpsiCanonicalIndexSnapshot` carries the same metadata,
`snapshotId` matching indexSnapshotId, and `horses` with horseNo and those six
primitives. Duplicate/foreign horses or forbidden row fields cause HOLD. A
present but invalid batch cannot fall back to per-horse inputs. Partial index
coverage remains explicit as per-runner INSUFFICIENT, never a fabricated score.

`horse.cpsiDomains.D/E/F/G` each carry the shared metadata plus
`sourceSnapshotId`, `indexSnapshotId`, `sourceClass:'PRE_COMPONENT_SCORER'`,
`use:'SHADOW'`, `status:'RESOLVED'`, and a 0–100 numeric value. Invalid identity,
phase, time, schema or use causes HOLD; missing compatible domains stay UNKNOWN.

`race.originalEarlyMarket` carries the shared metadata plus `snapshotId`
matching marketSnapshotId, `sourceRef`, `sourceClass:'PREDICTED_ODDS'` or
`'REAL_PRE_ODDS'`, and all active runners' horseNo/popularity/odds. Complete
unique popularity ranks and finite odds >= 1 are required. LIVE/FINAL cannot be
substituted. Changing market values never changes CPSI.

`race.waveEvidence` carries shared metadata, its `snapshotId`, matching
`indexSnapshotId` and `marketSnapshotId`, and optional
`favoriteHighestIndexRank`, `indexAuthorityRef`, `multiClusterCount`,
`clusterAuthorityRef`, `marketGapCount`, `marketGapAuthorityRef`. FIM requires a
matching index authority; unknown CL/MG remain unavailable.

`race.narWaveScMc` carries shared metadata, its `snapshotId`, matching
`indexSnapshotId` and `marketSnapshotId`, and NAR canonical SC/MC (0–100).
No JRA SC/MC derivation is performed.

## Population and Snapshot boundary

Normal Wave requires an explicit population classification:
`race.waveEligibility:'JRA_STANDARD_INDEX'` or `'NAR_FLAT'`. Missing classification
is HOLD. Newcomer, jump and banei tags route to NOT_APPLICABLE with a specialist
reason, even when a normal-population flag was supplied. The generic Wave is
not calculated for those populations. Fewer than two active runners is also
NOT_APPLICABLE. Specialty CPSI effects are not validated by this patch.

`makeSnapshot()` attaches `predictionSnapshot.cpsiWaveShadow` only inside the
new-Snapshot branch, before the existing integrity seal. Existing Original
EARLY Snapshots are never backfilled or recomputed. A known result-bearing
state produces HOLD. Missing input freeze or source data produces an explicit
HOLD/INSUFFICIENT; no raw ability-index proxy is promoted to canonical index.

The UI shows Shadow counts/score or reasons beside the existing metrics. It
does not overwrite legacy Volatility, marks, probability, EV, TIME, Final5,
diamonds or warnings. Probability MODEL_HOLD, formal KPI HOLD and Production
NO-GO remain. No workflow/Worker/D1/flag changes are included.

## Validation and remaining work

Tests include formula examples, partial neutral accounting, source/clock/circuit
conflicts, market-blindness, specialties, mocked-source adapters and actual app.js
Node VM Snapshot creation, integrity sealing, repeated calls and frozen-data
invariance. Browser asset tests retain the previous course module graph and add
only this public module. Run `npm run check` in Bridge before reviewing the PR.

The tests are synthetic. Live browser/Cloudflare E2E, Drive -> PRE producer,
physical artifact readback and real unseen-race materialization remain pending.
Do not claim that all races now have numeric CPSI/Wave, that source labels prove
authenticity, or that this Shadow patch completes the formal Wave process.
