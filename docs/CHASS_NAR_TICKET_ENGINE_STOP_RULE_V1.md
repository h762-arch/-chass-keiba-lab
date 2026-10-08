# CHASS NAR Ticket Engine + Stop Rule v1

Research-only integration contract. Production Activation remains NO-GO.

## Purpose

Phase 76 turns the Pair Evidence / Stop Rule / Swap Gate / Pool Gate / Freeze
Eligibility sequence into one fail-closed research engine. It does not replace or
rewrite any existing Prediction Freeze, Ticket Shadow, marks, signals or saved
race inputs.

Execution order is fixed:

1. Pair Evidence
2. Stop Rule
3. Swap Gate
4. Ticket Pool Gate
5. Freeze Eligibility

A later gate can never repair a failed or unknown earlier gate.

## Pair gate

Only explicit `pairDecision=PASS` may continue. Missing, malformed or unknown
values are `UNKNOWN -> HOLD`. `HOLD` remains HOLD. Only an explicit Pair
`REJECT` becomes line REJECT.

Individual horse strength, rank, index, PlaceFloor or ClassCeiling cannot by
itself promote a Pair to PASS.

## Stop Rule gate

Allowed classes are:

- `N/A`
- `CONTINUE_TARGETED`
- `STOP_STRUCTURAL`
- `STOP_DIRECT_NEGATIVE`
- `STOP_CURRENT_GATE`
- `STOP_SWAP_CLOSED`
- `STOP_LOW_MARGINAL`
- `STOP_SOURCE_EXHAUSTED`

`CONTINUE_TARGETED` means only that one bounded evidence search remains useful;
it never promotes HOLD to PASS. Every `STOP_*` class closes active acquisition
budget but preserves Pair HOLD unless Pair Evidence itself explicitly REJECTs.

A Pair already marked PASS must have Stop Rule `N/A`. A contradictory closed or
continue Stop Rule beside Pair PASS fails closed to HOLD.

## Swap gate

A non-swap line uses `N/A`. A requested swap must have explicit `swapGate=PASS`.
`NO_SWAP`, missing or unknown gate means the swap line cannot enter the pool.
The engine does not silently restore or rewrite an old Ticket Draft; it returns
HOLD and leaves the historical record untouched.

## Pool gate

All intended ticket lines must independently PASS. One PASS line does not
validate the other HOLD lines. A line REJECT makes the pool REJECT; otherwise any
non-PASS line makes the pool HOLD.

This pins the Phase 72 case: R10 WIDE #13-#5 may independently PASS while the
four-partner ticket pool remains HOLD.

## Freeze eligibility

Research Freeze eligibility requires all of:

- Pool PASS
- Identity PASS
- Leakage Guard PASS
- explicit pre-result-only confirmation
- explicit before-off-time confirmation

Any missing/unknown condition holds the Freeze. The module returns
`ELIGIBLE_SHADOW_ONLY` only when all conditions pass. It performs no write,
Freeze mutation, stake decision, purchase, Production D1 operation or runtime
flag change.

Every result remains:

- `researchOnly=true`
- `adopted=false`
- `formalKpiEligible=false`
- `executedStatus=NOT_EXECUTED`
- `freezeMutation=NONE`

## Phase 76 boundary

This module is deliberately isolated under `src/research`. No Worker route,
scheduled job, app UI, existing store, migration, D1 adapter or Production
runtime is wired by this patch. Forward Shadow adoption remains a separate gate.

## Consolidated candidate and strict missing-input behavior

This candidate follows the Drive implementation audit's 15-test Stop Rule
engine (original patch SHA-256
bf8650f06138eaf8dfde83cda5225fe13d1ad64faba1bbd18b950bf74138a70f),
not the separate 12-test ticket-pair-engine artifact (SHA-256
7f309de8abd10da311728158dc9d65bf33c97dfac584510d179b6d8cfa965ea7).
The two are not interchangeable and must not both be published as one version.

Unlike the original candidate, missing Stop Rule no longer defaults to N/A.
Every line requires explicit boolean swapRequested. A non-swap must explicitly
provide swapGate=N/A; missing/unknown or contradictory values hold the line.
SWAP_IN origin still requires SwapGate PASS even if a false boolean is supplied.
Null/malformed line and pool inputs are normalized to empty HOLD inputs.
No new evidence certification is introduced: PASS and time flags are still
caller claims, not authenticated source or trusted timing proof.

21 focused synthetic tests pass: the original 15 plus six missing/contradictory
input tests. These are not live prediction validation or proof of profitability.
Baseline main: 954809dd6685288e11e613a5be1991a5011496cb (PR #142).

## Next priority: Phase77 Prediction Evidence Bridge

The next development objective is prediction quality and traceable use of
accumulated research, not further Ticket-only excavation. The user's direction:

Drive canonical research -> validated Prediction Evidence Snapshot ->
Prediction Core -> EARLY Freeze -> separate Ticket Layer -> POST validation.

Production app/Worker code must read Snapshot/DB; no Production Google Drive
runtime reader or new OAuth wiring is included or planned by this patch.
The bridge prepares snapshots outside Production, preserves source/run/model
versions and immutable EARLY, and separates post-result research from pre-race
features. Race_ID and HorseKey must resolve before feature propagation.

Feature families include index, recent starts, course/distance, clocks, closing
speed, early position, pace/pressure, pedigree, weight/rider, race volatility
and diamond/warning research. Availability does not imply decision use. Track
AVAILABLE -> INSPECTED -> INTERPRETED -> PROPAGATED -> COMPARED -> DECISION_USED
with explicit evidence references; missing stages remain unknown. Never mark
DECISION_USED merely because a feature exists in Drive or is exported.

Changes to marks or AI win/place probabilities require validated consumer
behavior and calibration evidence. Missing values/probabilities must not be
invented, index must not become the sole driver, and the supplied diamond /
warning policy stays authoritative. Prediction and Ticket gates remain separate.
Formal adoption and Production Activation remain HOLD and NO-GO.

Sources: supplied signal policy; CHASS_TICKET_ENGINE_IMPL_AUDIT_V1 in the
canonical Drive archive master, read 2026-10-08; original candidate artifacts.
