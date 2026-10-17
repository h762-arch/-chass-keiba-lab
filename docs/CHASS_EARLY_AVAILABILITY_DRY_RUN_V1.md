# EARLY Availability: local read-only pre-start dry run

Base: 7e3e22766dbfdbf93947893d5cd00f49e2353626 (PR #247).

The opt-in NAR research capture adapter is merged. This CLI is the next local
verification step: inspect an actual pre-start snapshot without calling save,
freeze, D1, a network API or production runtime. It does not collect a snapshot.

## Required real inputs

1. `snapshot.json`: the unchanged app record or completed five-layer snapshot.
2. `context.json`: the actual declared pre-start cutoff and discovered runner
   count. For common acquisition fields, preserve the acquisition hook's exact
   `sourceReceipt` with scope, raceId, horseNos, capturedAt and sourceRef.

Do not replace these with today's date, a new clock timestamp or guessed source
metadata. Preserve both files as received. An old race is not eligible for a new
live pre-start check. Missing/old/result-bearing input must not be repaired or
reclassified by removing RESULT or regenerating Final5 after results.

Context shape (metavariables below are deliberately not fabricated values):

```js
{
  freezeAt: actualDeclaredCutoff,
  expectedRunnerCount: discoveredCoverageCount,
  sourceReceipt: actualAcquisitionReceipt // omit only if horse-level evidence exists
}
```

Optional persistenceDeclarations are caller declarations only. The script never
creates or certifies save/readback/freeze receipts from a local snapshot hash.

## Run after acquisition and Final5, before any live freeze

```sh
node scripts/dry-run-early-availability-v1.mjs \
  --snapshot /path/to/snapshot.json \
  --context /path/to/context.json
```

The script writes a JSON report to stdout only. If retaining it, redirect stdout
to a NEW report file, never either input. There is no --output or --now option.
Files must be regular non-symlink UTF-8 files up to 1,000,000 bytes each.
No file contents, RESULT payload, source references or input file paths are
included in the report. Exact UTF-8 SHA-256/byte lengths bind the supplied inputs;
these hashes do not prove origin or acquisition authenticity.

Exit 0 / LOCAL_PRESTART_MAPPING_READY means only that the supplied declarations
mapped to FULL or DEGRADED and the local process clock is on the same JST date,
at/after declared cutoff and strictly before the race's start. It is not a save
authorization. Inspect mappedPredictionReadiness and degradedReasons separately.
Exit 2 / HOLD covers invalid files/arguments, incomplete mapping, known results,
future cutoff, non-current race date or an observation at/after start. A report
may show a mapped FULL with outer HOLD: the current-time boundary is stricter
than relative snapshot mapping. Never treat mappedPredictionReadiness alone as
permission to proceed. The local OS clock is not an independently trusted clock.

## Verification and limits

Tests cover FULL/DEGRADED/HOLD, JST boundaries, observation at start, RESULT
exclusion, exact input hashes, unchanged input files, invalid UTF-8, bounded
reads, no replay flags and the actual CLI process exit code.
All supplied test snapshots are synthetic; no real pre-start snapshot was
provided during implementation. A genuine race dry run and the original
operational-error reproduction remain pending. Error logs may be added later
as regression fixtures without blocking this preparation.

No app, store, workflow or existing gate is changed by this patch. Original
Signals, diamonds and warnings remain untouched. Formal KPI HOLD, Probability
MODEL_HOLD and Production Activation NO-GO are fixed on every output path.
