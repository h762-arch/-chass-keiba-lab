# Phase96: isolated R2 evidence persistence and reconnect

Expected main: 203c5298cdb30d02ee99912fff5fe92229a2c51c (PR162).
Verified upstream tree: bc9a7b615504a5c964c4e075e7c8eecdcdffebf6.
Local reviewed-patch baseline matches that exact tree; the local baseline
commit is not represented as an upstream commit.

## Storage connection

`createPredictionR2QuarantineV2155({environment,storeId,bucket,operationTimeoutMs})`
uses an explicitly supplied R2 Workers API binding. `QUARANTINE`, a namespace
identifier and a 1..30000 ms timeout are required. Actual bucket identity,
credentials, isolation, lifecycle and retention policy must be independently
established by the operator. A namespace or string flag cannot authenticate a
bucket. This patch supplies no default bucket, route, binding or deployment.
The module uses node:crypto/Buffer and requires compatible Node facilities in
the calling runtime (Workers nodejs_compat when hosted there).

The existing Phase91/93 evidence can be supplied as `{payload,anchor}` to
`store.persist`. The independently retained acquisition anchor is required;
the module never derives trust from a hash stored alongside the remote data.
Before any write, transport-independent verification detaches and checks the
bounded payload, plan hash, identity, promotion prohibition, attempt bindings,
registry, source/receipt hashes and resolved source value. The pure verifier
does not claim storage. Existing local readback delegates to these same rules.
No filesystem dependency is imported by the remote storage module.

The canonical evidence JSON is stored as one object under
`quarantine/{storeId}/{SHA256(planId)}/evidence.json`. A single R2 put uses
`onlyIf: new Headers({'If-None-Match':'*'})`, a SHA256 upload checksum and
private/no-store JSON metadata. There is no unsafe read-then-unconditional-write
sequence. The trusted R2 service must honor the documented conditional-header
contract. This code never calls delete or performs an unconditional overwrite.
An object already present is read and verified: identical payload returns
EXISTING_IDENTICAL; different data returns IMMUTABLE_REMOTE_CONFLICT/HOLD.

Successful acknowledgement alone is insufficient. The subsequent get must
return the exact key/size, a bounded byte stream, exact body SHA256 and valid
registered acquisition evidence. Only then is REMOTE_READBACK_VERIFIED returned.
`receipt` binds storeId/key/byteLength/payloadHash/acquisitionAnchor. Retain it
independently outside the evidence bucket, then call `store.reconnect({receipt})`
from a new runtime/binding. Reconnect does no write and never adopts KPI data.
One total timeout covers the entire reconnect get/body read, including slow
streams; maximum body size remains 300000 bytes.

## Ambiguous writes

R2 promises cannot be cancelled by this adapter. If put throws or times out,
the write may still complete. The output is HOLD / OUTCOME_UNKNOWN with
`persisted:null`, not a fabricated claim that nothing was stored. A tentative
recovery receipt is returned. Do not retry automatically; use a later explicit
reconnect to resolve the outcome. No source acquisition is re-run by reconnect.
An acknowledged put followed by failed readback is ACKNOWLEDGED_UNVERIFIED with
persisted null. Conditional-create conflict confirms this call did not write.
Exceptions are sanitized; private provider errors are not returned.

Remote persistence preserves an existing acquisition HOLD or exhausted state;
it never turns them into RESOLVED or formal eligibility. Storage verification
does not prove source authentication, cutoff truth, external Freeze or adoption.
All formalKpiEligible/adopted/productionActivationReady flags remain false.
No Original Signal, probability, market contract or Prediction Freeze is changed.

## Example wiring

```js
const store = createPredictionR2QuarantineV2155({
  environment: 'QUARANTINE', storeId,
  bucket: independentlyVerifiedQuarantineBinding, operationTimeoutMs: 10000
});
if (store.status !== 'R2_STORE_READY') return store;
const remote = await store.persist({payload: local.payload, anchor: local.anchor});
// Preserve remote.receipt independently, including an OUTCOME_UNKNOWN receipt.
// A separate session may perform only:
const checked = await newSessionStore.reconnect({receipt: retainedReceipt});
```

## Validation and outstanding work

16 new synthetic tests model the R2 API contract with an in-memory binding.
They include full local execution, remote save/reconnect, conditional duplicates,
conflicting and concurrent writes, independent-anchor rejection, tampering,
foreign store/key, unknown write outcome and late completion, failed readback,
stream bounds/timeouts, source mismatch, promotion rejection and preservation
of HOLD/exhaustion. The emulator is not evidence of live R2 durability or actual
Workers compatibility. Source payloads and clocks in these tests are synthetic.
No remote account or live bucket was accessed.

No R2 administration capability for this repository was available in this
session. A real isolated bucket binding and independently retained receipt
destination remain operational inputs. No wrangler/runtime configuration,
production migration/write, live bucket creation, endpoint or secret is added.
Authenticated future-race source registration, actual isolated acquisition,
actual R2 conditional-write/readback validation and reconnect from a separate
runtime are still required. Core/Prediction Freeze and formal KPI connection
remain incomplete. Production Activation remains NO-GO.

## Sources

- Main: https://github.com/h762-arch/-chass-keiba-lab/commit/203c5298cdb30d02ee99912fff5fe92229a2c51c
- Policy: https://docs.google.com/document/d/1VivM-SpbiyKwJENk58wWlGdeBqGO0L1iapWXw4KQHhk/edit
- R2 put/get/conditional headers: https://developers.cloudflare.com/r2/api/workers/workers-api-reference/
