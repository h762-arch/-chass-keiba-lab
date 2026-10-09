# Phase89: bounded offline KPI ledger adapter

Base main: 08ac081b09156832c8203b235b285a5c0161c5a6 (PR155).
Authority: v2.15.5 / Baseline Readiness CONTRACT_V04, inspected in Phase88.
The prompt's modification time remains 2026-10-09T06:12:10.671Z in the Phase89
Drive metadata check. No new threshold or signal policy is introduced.

https://docs.google.com/document/d/1VivM-SpbiyKwJENk58wWlGdeBqGO0L1iapWXw4KQHhk/edit
https://docs.google.com/spreadsheets/d/1dqFySEgG6cYEXIx8BmOw7tPOe7wI90H_No1FRoXlgoI/edit

## Scope

`assessPredictionKpiLedgerBundleV2155({bundle,anchor})` connects a **normalized,
offline snapshot bundle** to the Phase88 policy evaluator. It checks integrity,
join identities, pre-off availability, and source values before evaluation.
It does not read Drive or D1, collect sources, perform acquisition, persist
snapshots, publish an API, or change existing KPI denominators.

This is not a raw spreadsheet importer. The current Drive policy templates do
not supply a complete authenticated per-race bundle. Do not convert template
strings such as CONTRACT, RUNTIME, POLICY_TEMPLATE into PASS or a real Freeze.
All new tests use synthetic inputs. No real formal KPI adoption is claimed.

## External trust and cryptographic limits

The caller must independently authenticate the bundle against immutable Freeze
records and pass an external anchor:

- schemaVersion VERIFIED_PREDICTION_KPI_INPUT_ANCHOR_V1
- runId, raceId, predictionFreezeId
- bundleSha256 (canonical JSON SHA-256), evidenceRef

The anchor must come from independent verified storage/provenance, not from the
untrusted bundle itself or an unverified CLI hash. This adapter checks that the
bundle matches the supplied anchor; it does **not authenticate the anchor**, its
evidenceRef, a user's account, a provider, gate PASS assertions, the Prediction
snapshot referenced by core.snapshotHash, or a pre-off storage timestamp.
External lineage/gate/snapshot verification remains a required caller step.

Rehashing modified section bodies cannot bypass an unchanged external anchor.
A forged bundle plus a forged matching anchor can still pass these integrity
checks. Therefore POLICY_READY is a policy candidate, not an adoption receipt.
Output states externalAuthentication=CALLER_MUST_VERIFY_ANCHOR. Regardless of
classification, formalKpiEligible=false, adopted=false and
productionActivationReady=false. There is no Production connection in this PR.

## Bundle contract

schemaVersion CHASS_PREDICTION_KPI_LEDGER_BUNDLE_V2155_V1, runId, raceId,
predictionFreezeId, immutableStatus FROZEN, exactly five distinct sections:

| kind | body | snapshotId binding |
|---|---|---|
| contract | Phase88 contract object | contract.freezeId |
| core | Phase88 core object | core.freezeId |
| fields | normalized field receipts | core.fieldEligibilityFreezeId |
| attempts | normalized acquisition attempts | core.acquisitionFreezeId |
| sources | normalized source registry records | unique source ledger Freeze ID |

Each section has a unique snapshotId, same runId/raceId, immutableStatus FROZEN,
frozenAt with explicit timezone, and contentSha256 over its body. Each section
is frozen no later than the pre-off Core Freeze. Contract/Core section times
match their bodies. Every field time matches the field section Freeze.
Every attempt occurs no later than its acquisition section Freeze.

Bounds: fields <=2000, contract fields <=2000, attempts <=8000,
sources <=10000, values per source <=2000, canonical bundle <=10 million
characters. Non-JSON values, cycles and malformed inputs become HOLD.

The normalized source registry records contain sourceSnapshotId, runId, raceId,
stage EARLY, capturedAt, dataAsOf, identityStatus PASS, sourceLineage PASS,
leakageGuard PASS, immutableStatus FROZEN, and values. These PASS assertions must
already have been independently verified by the caller, not inferred here.
dataAsOf <= capturedAt <= source-ledger frozenAt <= Core Freeze < offAt.
Source IDs are unique. Each values row has eligibilityId, fieldId, scopeKey,
value; eligibility IDs cannot duplicate within one source.

The contract source and every requirement snapshot must be in the registry and
captured no later than Contract Freeze. Resolved fields must join their exact
eligibilityId/fieldId/scopeKey in the named source. Values are compared as
canonical JSON, preserving real zero, null, scale and type without imputation.
The source must be captured before the field Freeze and before the FOUND
attempt. Sources from POST, another race/Run, or after the relevant Freeze fail.

Collection storage order has no decision authority. Fields are ordered by their
contract IDs and attempts by contract ID/attemptNo before Phase88 evaluation.
Duplicate IDs, number gaps and declared tier reordering are still rejected by
the policy evaluator. No missing row, reason or attempt is manufactured.

## Output and retained blockers

Successful integrity checks return exact section bindings, bundleSha256,
anchorEvidenceRef and the Phase88 assessment. Its policy-ready classifications
remain FORMAL_FULL or FORMAL_WITH_DECLARED_MISSING; a failed core/acquisition
gate remains HOLD/NOT_FORMAL. Exhausted eligible numerics remain in their
eligible denominator. Missingness is not Negative, zero, 50 or a probability.

Pre-evaluation failures return HOLD with a bounded reason and no assessment.
Unknown exceptions do not expose private transport/provider details.
Inputs are not mutated; returned results are deeply frozen.

Remaining work: authenticated per-race snapshot export/readback, real bounded
acquisition execution, verified Core/Final5/Role/source Freeze receipts, then
separate NAR core save admission and JRA field-specific KPI contract joins.
Formal prediction KPI denominator wiring is still pending. Existing Original
Signal, old EARLY snapshots, app.js, Worker, runtime flags, D1 and deployment
configuration are unchanged. Production Activation remains NO-GO.
