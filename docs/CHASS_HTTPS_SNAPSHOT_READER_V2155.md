# Phase95: preregistered HTTPS snapshot acquisition

Expected main: 1966392cd9aa2b09345dd99e6f93643460c33854 (PR161).
Verified upstream tree: b118d84803a21d92d2ea6d1eb4f4264c0ad10911.
Local baseline is reconstructed from reviewed patches and matches that exact
tree; its local commit is not presented as an upstream commit.

## Connection provided

`createPredictionHttpsSnapshotReadersV2155` creates Node-only readers for the
Phase92 registry and Phase93 atomic evidence store. It performs an actual GET
through native Node fetch when invoked without the optional test transport.
It reads a normalized immutable SourceSnapshot JSON endpoint, not arbitrary
official HTML, Drive web pages, image/PDF files or dynamic odds responses.
Upstream authenticated capture and normalization are still separate requirements.

Caller supplies environment `QUARANTINE`, 1..4 trusted `allowedOrigins`, and
1..4 bindings with readerId/sourceRef/planHash/expectedSha256/expectedBytes and
maxRequestMs. Exact expected hashes and sizes must be independently retained
before retrieval. Unknown live response bytes cannot be blessed by hashing
them after retrieval. Use a frozen snapshot service or independently registered
immutable object. Every Phase92 registry entry needs a matching reader binding.

Authorization is optional, supplied privately as
`authorizationByReader[readerId]` at construction, captured by the reader, and
used only as the Authorization request header. It is not returned or logged.
Do not put credentials in sourceRef, query strings, plan or registry metadata.
Authorization is transport access only, not proof of source truth or Freeze.

Registered context and exact endpoint are checked before request. HTTPS with
explicit trusted origins is required. URL credentials/fragments, IP literals
and localhost are rejected. Redirects are rejected before following them;
response URL/redirected state must also match. Requests use GET, credentials
omit, cache no-store and Accept-Encoding identity. Origins and DNS must be
administratively trusted: this is not an SSRF sandbox or DNS-rebinding defense.

Only 200 application/json with identity encoding is accepted. A 404 is an
actual NOT_FOUND attempt. Authentication failures, rate limits, other statuses,
network failures, redirects, body/identity/hash conflict and timeout are CONFLICT
and stop Phase90 at HOLD. No retry, silent endpoint substitution or fabricated
exhaustion is introduced. True exhaustion requires all four registered sources
to return supported terminal absence through the bounded executor.

Body reads are streamed and capped at the expected size (1..50000 bytes).
Content-Length, when supplied, must match. Raw UTF-8 JSON body SHA256 and size
must match preregistration. Compression is rejected, so retained `rawBase64`
is the exact fetch response body, not compressed bytes or HTTP/TLS wire bytes.
An internal bounded timer and executor AbortSignal cover fetch and body reads;
promise races bound uncooperative test transports. Real fetch receives abort.
Late responses cannot produce a FOUND return. Cancellation errors are sanitized.

Snapshot run/race/field/scope identity and EARLY/PASS provenance must already
exist and match. No value, PASS or observation time is manufactured. Phase90
continues to validate source capturedAt/dataAsOf and acquisition completion
against cutoff. `httpsReadEvidence.receivedAt` records actual local reception;
it never fills capturedAt or establishes historical pre-cutoff availability.
The source value and original JSON bytes are retained in Phase93's same atomic
evidence document for reconnect inspection. Existing 200k response and 300k
document limits still apply. Every adoption/activation flag remains false.

## Example wiring (configuration supplied out of band)

```js
const ready = createPredictionHttpsSnapshotReadersV2155({
  environment: 'QUARANTINE', allowedOrigins, bindings, authorizationByReader
});
if (ready.status !== 'READERS_READY') return ready;
return executeRegisteredPredictionAcquisitionEvidenceV2155({
  environment: 'QUARANTINE', root: isolatedEvidenceRoot,
  plan, registry, registryAnchor, readers: ready.readers
});
```

No default endpoint, credential, source root or race is invented. No network
request happens at construction. No Worker/browser route, runtime flag,
Production D1 write, remote evidence upload or formal KPI admission is added.

## Current-source check and validation

Drive metadata and exact bounded reads on 2026-10-09:
CHASS_V215_SOURCE_REGISTRY_V1 / CHASS_V215_PROVIDER_MAP_V1 /
CHASS_V215_RUN_MANIFEST_V1 / CHASS_V215_ACQUISITION_LEDGER_V1, each A1:P12.
These ranges show prior SHADOW records, provider specifications and acquisition
contract rows. They do not establish a future race's frozen HTTPS bindings or
authenticated snapshot endpoint. This statement is limited to the read ranges.
An initial read with an abbreviated tab name failed; metadata was refreshed
and only exact observed tab titles were used for subsequent reads.

16 synthetic tests use injected fetch/Response/ReadableStream objects, including
full Phase93 persistence/reconnect. They cover exact request, byte tampering,
404 exhaustion, auth/rate-limit/server HOLD, stream bound, HTML/compression,
redirect, foreign identity, missing capture time, request/body timeout,
pre-abort, private authorization, setup rejection and captured configuration.
No live provider, real race or authenticated remote save was exercised.

Next required operational inputs: an actual future race with frozen field
contract and preregistered immutable SourceSnapshots, authenticated HTTPS
endpoints/bindings, and a separately isolated durable remote evidence destination
with independently retained anchors and reconnect receipts. Historical snapshots
must not be relabeled FORWARD or used to backfill Original EARLY.
Production Activation remains NO-GO.

## Sources

- Policy: https://docs.google.com/document/d/1VivM-SpbiyKwJENk58wWlGdeBqGO0L1iapWXw4KQHhk/edit
- Master: https://docs.google.com/spreadsheets/d/1dqFySEgG6cYEXIx8BmOw7tPOe7wI90H_No1FRoXlgoI/edit
- Node fetch/AbortSignal: https://nodejs.org/docs/latest/api/globals.html
- Fetch redirects: https://developer.mozilla.org/en-US/docs/Web/API/Response/redirected
