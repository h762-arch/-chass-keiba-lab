# EARLY prefreeze gate v1 — reviewed independent application

The uploaded ZIP contains the module, four tests and README_PATCH.md. Its original
four synthetic tests pass locally. Review also reproduced two unsafe interpretations:
all caller-supplied booleans plus placeholder hashes produced formalReadiness PASS,
and empty input returned earlyImmutable true without an actual frozen record.
Those are not evidence of production or EARLY verification.

## Applied scope

Three new files only: `src/prediction/early-prefreeze-gate-v1.mjs`, its matching
`tests/early-prefreeze-gate-v1.test.mjs`, and this document (the ZIP README is
incorporated here rather than placed at repository root). Existing files, runtime,
D1, collectors, workflows, model flags and KPI contracts remain unchanged.

```sh
node --test tests/early-prefreeze-gate-v1.test.mjs
```

The exported name `assessEarlyPrefreezeGate` and VERSION constant are retained.
The module has no imports, IO, persistence, network, model, writer or freeze action.
It clones bounded JSON declarations without invoking getters/toJSON, accepts at
most 30 runners and handles malformed inputs with HOLD rather than throwing.

## Corrected interpretation

- `candidateReadiness` assesses only the required declarations G01–G07/G09/G10.
- `formalReadiness` and G11 always HOLD: no caller flag can authenticate receipts.
- `formalKpiEligible`, `persistenceVerified`, `acquisitionCertified` and
  `earlyFreezeVerified` remain false. `earlyImmutable` is null (unknown).
- `declaredEarlyImmutable` and `formalContractDeclared` reflect caller statements
  separately; neither is independent verification.
- Probability stays MODEL_HOLD and Production Activation NO-GO.

PASS in a candidate gate is a structural declaration assessment, not an authenticated
source/readback verdict. A future, separately reviewed integration must supply
independently verified identity, source timestamps, saved bytes/hashes, immutable
anchors and receipts. This standalone module has no formal-promotion capability.
It does not compare declarations against the current clock: explicit timezone and
calendar validity plus relative ordering are checked, not historical provenance.

Hashes must have SHA-256 shape, but are not recomputed without their original bytes.
The temporal declaration chain is capture <= evidence save <= snapshot save <=
freeze < start; a supplied result time must follow freeze. Equivalent timezone
instants are accepted. Relative order alone does not establish genuine acquisition.

G08 market absence/unknown remains supplementary and never invents market presence.
G12 is a separate post-result comparison: result time, comparison time and the
original freeze ID must agree. It cannot block or rewrite the original prefreeze
assessment, and does not promote formal readiness. No mark/diamond/warning is assigned
or changed. Original EARLY remains the primary fixed prediction/KPI comparison axis;
T15/T5/FINAL are supplemental, and results never repair Original Signal.

The uploaded test expecting unconditional earlyImmutable true was corrected to
expect unknown. The remaining original cases are preserved, with expanded checks
for synthetic false promotion, hash/timestamp/roster errors and evidence ordering.

## Existing integration candidates (read-only inspection, not connected)

| Existing code | Confirmed role | Future evidence boundary |
| --- | --- | --- |
| `src/prediction/precomputed-snapshot.mjs` | Creates SOURCE/DATA snapshots and source/input/snapshot hashes | Bind exact race ID, source acquisition time, versions and declared signal hash; do not equate DATA snapshot with EARLY Signal Freeze |
| `src/prediction/precomputed-store.mjs` | `savePrecomputedSnapshot`, revision lookup and `readLatestPrecomputedSnapshot` read/restore D1 records | Bind exact saved revision/hash and readback, not a caller boolean or merely the latest revision |
| `src/prediction/prediction-registered-acquisition-evidence-v2155.mjs` | Quarantined evidence execution/readback plus registry/anchor verification | Reuse authenticated provenance boundaries before mapping per-runner evidence declarations |
| `src/prediction/prediction-kpi-contract-v2155.mjs` | Existing frozen-contract, acquisition/field binding policy assessment | Preserve this contract; the new gate neither replaces nor bypasses its requirements |
| `src/prediction/prediction-kpi-ledger-adapter-v2155.mjs` | Ledger section identity/hash/binding assessment with external trust required | Bind original freeze/contract IDs and independent trust anchor before any separately authorized formal adoption |

No mapping adapter or production hook is included in this change. These existing
functions do not by themselves prove a canonical global horse ID, an authenticated
EARLY signal receipt or real model readiness. Those connections remain unverified.

G09/G10 refer to an already declared freeze/readback record. They cannot be wired
as prerequisites that require a newly created freeze receipt before that same
freeze can be saved. A future adapter must separate pre-save admission checks from
post-save immutable-receipt/readback confirmation; this module does neither action.

## Regression and release

Base main inspected: `8ebb7b968dbea859802fcb7d826b66a365830612`.
Run full repository check as well as focused tests. Local browser tests require
Chrome; Bridge must pass full regression before merge GO. The separate pending
Phase140.34 patch is not included in this new branch or test baseline.
After merge, verify exact file contents before discussing any integration adapter.
