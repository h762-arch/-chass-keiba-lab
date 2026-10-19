# Cloud sync outcome and conflict handling v1

Base PR #264: 0e9e9ba3683d35429322b4e533413f0d5a22dde3.
Verified tree: 617a2feb789c702108b434be1a6594bc15f02bcc.
Prior GitHub CI: 3517/3517 pass, 0 fail, 0 skip.

## Per-record outcomes

The Worker returns acknowledged created/updated/unchanged rows, explicit
conflicts, unknown outcomes, and not_attempted rows separately. Payload counts
are derived from these rows. No all-or-nothing batch transaction is claimed.
Binding/schema/duplicate-identity preflight happens before database access.
If one sequential save throws, earlier acknowledgments remain in the response;
the current row is outcomeKnown=false, written=null, and the tail is unattempted.
HTTP 409 means explicit stored conflicts; HTTP 500 can include partial success.
The old remote-result-preserved branch now supplies a reason, so a browser cannot
mistake an incomplete local payload for an equal remote saved record.

The browser retains sync error responses for per-record reconciliation.
It counts row acknowledgments rather than trusting aggregate counts. Missing,
duplicate, wrong-identity, wrong-model or contradictory acknowledgments cannot
clear pending state as a successful save. An unverifiable response becomes HOLD.
An older explicit created/updated acknowledgment can be accepted without a
descriptor, but no local descriptor is invented and cached as remote evidence.
Unchanged requires a matching returned descriptor, or fresh manifest agreement.

## Durable holds and retry behavior

A separate versioned local metadata map records race/model/reason/heldAt only.
It does not contain or edit saved Prediction, Signal, odds or Result snapshots.
Known conflicts and ambiguous POST outcomes leave the retryable pending set and
enter HOLD. Repeated saves, reload initialization and bulk sync do not repost
held identities. Changing local bytes alone does not release a same-model hold.
A different model is a separate identity and is not blocked by an older hold.

Holding invalidates the previous acknowledgment cache entry. A successful
fresh manifest read that matches every existing fingerprint/status can clear
the hold without a POST. This is equality of the existing synchronization
descriptors, not source authentication, cryptographic proof or formal EARLY
readiness. Explicit local cloudConflict records remain held for review.
There is no automatic original repair, winner selection or destructive
conflict-resolution button. Genuine differing originals require ledger review.
Stale/obsolete held model entries remain visible until separately resolved.

Unknown POST outcomes stop subsequent bulk chunks; untouched tail records stay
pending. A known conflict does not discard acknowledgments or independent later
chunks. Historical batch sync uses the same outcomes and counts only its
unacknowledged rows as cloudFailure. No historical collection/replay was run.

## Concurrency and freshness

Every POST uses a cloned outgoing record. Responses are compared with the
current cache revision before clearing pending. An acknowledgment for an older
revision cannot label a newer local revision synchronized.
Race/model flights serialize overlapping single/bulk requests, and concurrent
bulk calls share one task. Repeated identical requests reuse the verified
acknowledgment cache; a queued newer explicit save can send after the old flight.
No timer, automatic retry scheduler or new automatic API acquisition is added.
Bulk chunks remain capped at 25, with the server request cap unchanged at 250.

created/updated/unchanged are acknowledged operation counts. target counts
transmitted records, including conflicting POST rows. held/failed/pending are
outcome categories for this invocation; the live pending indicator can also
include a newer local revision created during the invocation.
lastSyncedAt advances for actual acknowledgments or a fully matching fresh
manifest, never for a successful research-dataset GET alone.

## Browser display and contract alignment

The dashboard has a separate hold-detail panel with race, model and plain reason.
No raw snapshots, source references or fingerprint internals are displayed.
Bulk controls remain busy until the bulk task settles. Unchanged POST outcomes
are counted and are not mislabeled as zero sync targets.
Research refresh/restore cannot hide durable holds as synchronized success.
Browser queue-only descriptor status follows the Worker's complete-result
rules, so terminal queue labels alone do not produce endless manifest differences.

## Verification and limits

46 new VM/fake-D1 tests cover partial 409/500 responses, preflight and duplicate
identities, protocol ambiguity, saved-result preservation, hold persistence,
manifest reconciliation, concurrency/new revision preservation, 25-row chunks,
historical accounting, status rendering and browser/Worker descriptor parity.
The earlier single-race cache test now uses a complete real descriptor and
asserts an actual acknowledged status.

VM DOM tests check text/state and use mock storage/fetch only. They are not real
browser visual QA or deployed-device evidence. No real D1/localStorage write,
live race acquisition, external connector sync, EARLY Freeze, runtime flag
change, merge or deploy was performed. Existing frozen-write protections and
prediction/Signal evaluation functions are retained.

The browser can handle the previous Worker's normal/409 replies, but runtime
failure detail improvements require the updated Worker. Deployed browser and
Worker revision pairing remains unverified. Mixed/legacy servers without
verifiable acknowledgments may conservatively hold until manifest review.
Real evidence/result ledger copies, target list and provenance remain required
for original/local/cloud log comparison. That audit is incomplete. This batch
does not prove accuracy/ROI improvement or resolution of the old NAR live error.
Formal KPI HOLD / Probability MODEL_HOLD / Production Activation NO-GO.
