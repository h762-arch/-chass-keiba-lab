# Cloud fingerprint metadata recovery v1

## Problem and scope

The home-screen backup exported at 2026-10-19T10:24:05.063Z contains 1,401
MANIFEST_FINGERPRINT_UNAVAILABLE holds. The other 57 holds concern 40 repaired
results, 13 original prediction conflicts and 4 identity conflicts. This action
selects only the missing-fingerprint holds; those other reasons remain separate.

This patch prepares an explicit user-triggered operation that **writes derived
fingerprint metadata to production D1 when its button is pressed**. Creating the
patch, running tests and running the Patch PR Bridge do not execute the action.
The working session performed no production metadata recovery writes.

## Server boundary

POST `/api/db/recover-fingerprints` accepts only raceId and modelVersion, one
identity per request. The streaming JSON body is limited to 1,024 bytes. There
is no GET mutation and no automatic scheduler or startup invocation.

For that exact race/model, it reads one row and derives missing fingerprints
from the server's own stored JSON. The caller cannot provide replacement
predictions, results, signals, hashes or timestamps. It does not initialize
schemas, run migrations, fetch outside data or enqueue other synchronization.

The only UPDATE assignments are the seven *_fp columns. Nonempty existing
fingerprints are preserved. If an existing fingerprint contradicts its stored
source, the row is skipped for review. Malformed JSON, inconsistent bindings
and source JSON exceeding 256 KiB are also skipped. Existing complete metadata
returns already_present without another UPDATE.

An UPDATE compares all six original JSON strings, status, updated_at and all
seven old fingerprint values, as well as race/model identity. A concurrent
change yields zero updates and is reported as concurrent_change. Exactly one
changed row is required before metadataWritten is reported as true. No source
JSON, forecast, mark, result, validation flag or timestamp is assigned by SQL.

## Browser boundary

The button is labelled `照合情報を回復（クラウド更新）` and has explanatory text
that this action recreates comparison information from cloud-stored data.

It first reads a fresh scalar manifest, then handles at most 1,500 existing
missing-metadata holds sequentially. A target already having complete metadata
does not receive another POST. Each request uses a 20-second deadline, and
the shared operation lock keeps it separate from ordinary sync/restore/repair.

The browser clears a missing-metadata hold only when the returned identity,
complete descriptor, every fingerprint and status agree with the unchanged
local revision. Recovery success and local agreement are separate counts. A
cloud metadata update alone does not prove that the local forecast matches.
Local race records and original signals are not changed by this operation.

On a communication failure, the operation stops, retaining completed metadata
updates and verified releases. A rerun starts from a fresh manifest; a lost
response can therefore be reconciled without rewriting the original record.
Progress, ready/recovered/cleared/conflict/skipped/deferred counts and remaining
holds persist in the existing diagnostic state and backup. A recovered hash is
the existing application comparison format, not formal EARLY certification.

## Validation and limits

Real in-memory SQLite tests verify preservation of original column bytes,
idempotence, conflicting fingerprints, compare-and-update behavior even when
timestamps are unchanged, record size bounds and safe failures. Browser tests
verify identity-only POSTs, hold-release conditions, preserved local records,
partial progress, single flight and reload diagnostics. Production latency,
CPU-limit behavior and the number of rows that will pass agreement remain
unverified until a controlled user operation after deployment.

The 40 repaired-result holds and 17 original/identity conflicts are not forcibly
released. This patch does not merge Safari and home-screen datasets or promote
reference data into formal KPI eligibility.

Formal KPI HOLD / Probability MODEL_HOLD / Production NO-GO.

## Sources

- https://github.com/h762-arch/-chass-keiba-lab/pull/271
- User-provided before/after home-screen backups and their sync diagnostics.
