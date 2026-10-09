# Phase93: registered source evidence retained with acquisition output

Expected main: 02123f59f9807bc781d5189fb3d5dbd7f84bff44 (PR159).
Verified baseline tree: 2a0a2fcee8514f08b810873730e6bd9400ed2c74.
Local history reconstructed from the prior verified tree plus exact PR159 patch;
source tree equals upstream main. No upstream commit was invented.
Authority: official v2.15.5 Acquisition-First / CONTRACT_V04, previously read:
https://docs.google.com/document/d/1VivM-SpbiyKwJENk58wWlGdeBqGO0L1iapWXw4KQHhk/edit

## Scope

`executeRegisteredPredictionAcquisitionEvidenceV2155` combines Phase92 registration,
Phase90 bounded execution and Phase91 local quarantine publication. A detached
registration and its separately supplied registry anchor are retained with source
read traces in the same canonical evidence.json as the plan, attempts and field
state. No separate partially published source ledger is created.

Each reader returns {sourceRef,receipt,sourceSnapshot}. For FOUND, sourceSnapshot
must contain sourceRef, payload (non-null original JSON source payload), and exact
receipt metadata: sourceSnapshotId/runId/raceId/eligibilityId/fieldId/scopeKey,
sourceStage/identityStatus/sourceLineage/leakageGuard/capturedAt/dataAsOf/value.
The receipt result itself is not a snapshot field. Caller adapters own extraction
and normalization; this module preserves payload but does not parse raw images,
PDFs, HTML or Sheets or prove that a value was correctly derived from that payload.

A missing/malformed/mismatched FOUND source envelope is converted to a sanitized
CONFLICT before Phase90 accepts a value. No downstream tier proceeds on that
conflict. Invalid response bodies are not retained. Phase90 records the conflict
attempt; traces retain valid bounded reader envelopes only. Exceptions are
sanitized by Phase90 and do not store private error messages. A thrown or timed-out
read may have no source trace, but its actual attempt remains in acquisition output.
After abort, late responses cannot append source evidence to the saved document.

Valid FOUND traces retain the exact copied JSON payload and canonical SHA256.
NON-FOUND traces retain the actual receipt/reason and registered sourceRef.
`readRegisteredPredictionAcquisitionEvidenceV2155` verifies the outer retained
anchor first, then registry bindings/hash, trace-to-attempt bindings, snapshot
metadata/source hash and resolved source value. A fresh process can verify the
complete document. Mismatch is HOLD; it does not imply no data was written.

The Phase91 store has one optional supportingEvidence argument. It copies this
caller-owned evidence after executor completion, before atomic publication. Legacy
calls omit it and preserve their previous payload shape. The generic store validates
JSON/total size and outer integrity only; the new specialized reader owns source
semantics. Total document stays bounded at 300000 bytes; one supplied JSON evidence
body is bounded at 200000 bytes. Oversized inputs fail closed rather than truncate.

## Trust and limitations

Explicit QUARANTINE environment and a trusted dedicated local root remain required.
Hashes prove integrity relative to a trusted retained receipt, not provider honesty,
authentication, external Freeze or formal adoption. A dishonest reader can fabricate
self-consistent source metadata/payload. Authenticate readers, independently verify
Source/Identity/Availability and preserve the receipt outside the evidence root.
Stored registry anchor is retained for audit, not newly authenticated by storing it.
Local atomic directory publication still lacks fsync crash durability and offsite
retention. No Drive/D1 write, HTTP reader, real race, formal Freeze, probability
promotion, KPI admission or runtime activation is added. Registry/source preservation
is now complete for this local synthetic execution, not for a production run.
All formal/adoption/activation flags remain false. Original Signal is unchanged.

## Validation

15 new synthetic tests plus Phase88-92 related tests: source/registry retention,
exhaustion, zero, missing/foreign metadata, POST receipt, size bound, sanitized
exceptions, bad anchor, tampering, revision conflict, input mutation, fresh-process
reconnect, invalid environment, late timeout and rehashed source-value mismatch.
The full repository check is reported separately from focused tests.

## Next connection

Establish a concrete future race and a frozen per-field contract; register and
authenticate actual source readers; retain original provider bytes when not JSON.
Execute and independently verify pre-cutoff Source/Identity/Availability, isolated
remote persistence and formal Core/Prediction Freeze before KPI adoption.
Production Activation remains NO-GO.
