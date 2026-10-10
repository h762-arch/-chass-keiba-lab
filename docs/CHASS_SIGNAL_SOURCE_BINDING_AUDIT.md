# Phase111: frozen Signal source binding audit

## Purpose and authority

Extend Phase110 with a pure, read-only join to captured Source Registry records.
The Prediction v2.15.5 Evidence Ledger requires source lineage and counts
independence groups rather than rows. V5-05/V5-06 require independent Signal
support; V5-25 prohibits later-market/result reconstruction of Original EARLY.

- https://docs.google.com/document/d/1VivM-SpbiyKwJENk58wWlGdeBqGO0L1iapWXw4KQHhk/edit
- https://docs.google.com/spreadsheets/d/1dqFySEgG6cYEXIx8BmOw7tPOe7wI90H_No1FRoXlgoI/edit
  CHASS_統合適用ルール_v5, inspected A1:H45 on 2026-10-11 JST.

## Input contract

`auditSignalSourceBindings(input,{cryptoImpl})` receives only captured JSON.
Input contains Phase110 scope/snapshot/evidence/survivalReviews plus sources
and manifest. It clones the capture before its first async hash operation;
caller mutations during hashing cannot change the assessment.

Manifest schemaVersion=1, immutableStatus=FROZEN, runId/raceId/freezeId/
sourceSnapshotId exactly match scope. frozenAt exactly matches Signal frozenAt,
uses an explicit timezone and must precede explicit offAt. SHA-256 fields
snapshotHash/evidenceHash/survivalReviewsHash/sourcesHash cover all four captured
objects using the existing stableHash implementation. Hashes must be the
previously retained manifest receipts, not produced after an edit to excuse it.

Source rows bind the same scope, horseNo, unique sourceRef, originId,
independenceGroup, family, EARLY stage, capturedAt, dataAsOf, payload and its
payloadHash. dataAsOf <= capturedAt <= Signal Freeze. A known eligible resolved
conflict-free evidence row joins sourceRef and must match horse/family/group;
source capture must precede evidence capture/interpretation. Source payload hash
is checked independently of the outer registry hash.

originId is the canonical source episode identifier from the upstream registry.
Multiple derived measures from one horse/episode cannot claim distinct groups.
Distinct codes/families do not override that rule. originId is not a provider URL
or metric name; the upstream collector must normalize correlated source episodes.
Two providers repeating one underlying episode must preserve its originId.

Unresolved/ineligible/UNKNOWN/conflicting evidence does not require an invented
source payload and remains visible to Phase110. A missing source for a known
usable row produces UNVERIFIED, never a positive/negative substitute.

Limits: 8000 evidence/source rows, 99 survival reviews, JSON depth32/node100000.
Nonfinite values, cycles and non-JSON objects reject. Duplicate source refs,
scope mismatch, post-Freeze/LIVE/POST source receipts, hash edits and inconsistent
episode groups reject. No network, DB, filesystem or save API exists here.

## Output and limits

READY / CONTENT_BOUND means the supplied manifest, source records and evidence
join passed. Read nested audit.rows for STRUCTURAL_PASS / UNVERIFIED / VIOLATION;
READY does not mean all signals passed. A Signal violation can coexist with a
successfully bound capture. Outputs are deeply immutable and leave input unchanged.

Always authenticity=NOT_VERIFIED, adopted=false, formalKpiEligible=false,
productionActivationReady=false. Matching self-supplied hashes do not authenticate
the registry or prove source truth, origin-group correctness, semantic stage
classification, scenario quality or adequacy of a Popular Survival review.
The trusted adapter must retrieve the actual immutable manifest and normalized
registry from canonical storage and independently validate lineage/identity.
A caller able to replace both data and its manifest can forge consistent content;
this research utility is not a signature verifier or a production permission gate.

This patch does not create formal marks, select Final5, verify calibrated
probabilities or Strict EV, connect a production Signal builder, alter DATA-only
EARLY Readers, activate the MARKET queue, or modify Worker/UI/runtime flags.
Original snapshots are never repaired with current odds or results. Core KPI
continuity remains distinct from field-specific probability/market eligibility.

## Verification and next connection

Tests cover source/hash edits, same-episode evidence inflation, scope/horse/group
mismatch, incomplete sources, UNKNOWN, temporal leakage, manifest Freeze timing,
duplicate identities, malformed captures and mutations during async hashing.
They use synthetic captures, not authenticated production manifests.

The next adapter needs actual immutable snapshot/manifest/Source Registry reads
and verified race/time identities. That connection is still unimplemented.
MARKET queue timing, audit-table readiness and daily Freeze coverage remain
separate unfinished production tasks; this patch does not claim throughput gains.
