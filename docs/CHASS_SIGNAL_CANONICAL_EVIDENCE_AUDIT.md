# Phase110: Canonical Signal evidence audit (research only)

Authority read on 2026-10-11 JST:

- Prediction prompt v2.15.5:
  https://docs.google.com/document/d/1VivM-SpbiyKwJENk58wWlGdeBqGO0L1iapWXw4KQHhk/edit
- Current integrated rules: CHASS_統合適用ルール_v5 A1:H45, V5-05,
  V5-06, V5-22, V5-25 and V5-28:
  https://docs.google.com/spreadsheets/d/1dqFySEgG6cYEXIx8BmOw7tPOe7wI90H_No1FRoXlgoI/edit
- POST improvement prompt v2.0:
  https://docs.google.com/document/d/1WBPhTkq7JlJ2eipX3KLkDaBZYawvT5q5z1OXjz-_GGE/edit

## Findings

`app.js` contains CHASS-SIGNAL-v1.0, popularity boundaries, mark exclusion,
Original Signal restoration and no EV-only warning. Its longshot scenario text
is templated and its evidence codes/scores do not prove independent source groups.
`jra-model.js` also retains a legacy score-based market flag calculation. Neither
path is adopted into the precomputed MARKET bridge by this patch.
`signal-rule-audit.mjs` explicitly audits structure, not scenario quality; distinct
codes are not proof of distinct IndependenceGroups. Existing historical audits
are retained with their original meaning.

V5-06 requires two independent known negative groups and a Popular Survival
review. V5-05 requires multiple strong independent groups for triple diamonds.
v2.15.5 separates core prediction KPI eligibility from availability of numeric
probability/market fields. V5-22 permits quality-qualified prediction odds from
an index sheet; real betting odds are not mandatory for Original EARLY. Strict
formal EV separately requires a promoted probability and formal market contract.
These requirements must not be reduced to “complete odds means formal Signal”.

## Isolated API

`auditSignalEvidenceLedger({scope,snapshot,evidence,survivalReviews})` calls the
existing structural audit and joins caller-supplied pre-freeze receipts.
Scope requires runId, raceId, freezeId and sourceSnapshotId. Each evidence row
binds that scope and horseNo, unique evidenceId, independenceGroup, family,
sourceRef, description, direction (POSITIVE/NEGATIVE/UNKNOWN), resolution
(RESOLVED/SOURCE_MISSING/READ_FAILED/NOT_APPLICABLE), eligibility
(ELIGIBLE/INELIGIBLE), strength (NORMAL/STRONG), conflict boolean, EARLY stage,
and capturedAt with an explicit timezone no later than Signal Freeze.
The adapter must supply the already normalized eligibility/strength semantics;
this API does not invent a strong-evidence score threshold.

Only eligible, resolved, conflict-free known receipts count. MARKET and
INDEX_CLUSTER receipts never count as ability support. Count distinct groups,
not rows. Missing/insufficient evidence remains UNVERIFIED rather than weak.
Warning reviews bind the same scope/horse and carry reviewedAt, decision
(CLEAR/VETO/UNKNOWN), reason and nonempty evidenceIds. A VETO is a violation.
Missing or unresolved review inputs remain unverified.

Malformed, duplicate, cross-scope, LIVE/POST or post-freeze receipts reject.
Inputs are never changed; output is deeply immutable. Existing snapshots without
the additional ledger remain unverified and must never be reconstructed using
current or result information.

## Limits and next connection

STRUCTURAL_PASS means supplied receipts meet this limited join contract. It
does not authenticate provider provenance, bind the actual snapshot bytes to the
scope, evaluate the scenario's racing merit, prove survival review adequacy,
verify probability promotion/Strict EV, or complete the whole Prediction Gate.
The caller must authenticate ledger scope, hashes and lineage independently.
Outputs always retain authenticity=NOT_VERIFIED, scenarioQuality=NOT_EVALUATED,
adopted=false, formalKpiEligible=false, productionActivationReady=false.

No Worker/API/UI imports, DATA Reader changes, D1 writes, market queue activation,
production coefficients, automatic marks or original snapshot edits are added.
Before any formal Signal builder, connect authenticated frozen DATA/MARKET,
Evidence Ledger, scenario/Popular Survival reviews and probability/market
contracts. Budget/throughput validation for the MARKET queue remains a separate
unfinished task; this patch does not solve or claim to solve it.
