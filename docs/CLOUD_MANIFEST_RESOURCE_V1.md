# Cloud manifest resource guard v1

## Evidence and scope

On 2026-10-19 at approximately 18:33 JST, a read-only request to
`https://chass-keiba-lab7.h7625421.workers.dev/api/db/manifest`
returned HTTP 503 with `error code: 1102`. The health route returned
`ok: true, database: connected`. Cloudflare documents 1102 as a Worker CPU
or memory resource-limit error; which limit was reached is not established.
The earlier request at 18:19 JST returned valid JSON with 1,657 records.
Intermittent resource failure is observed; a specific hot path is not proven
by a production CPU profile.

The prior manifest implementation could load and hash up to 5,000 full
legacy snapshot sets when stored fingerprints were missing. A general
exception could also trigger a full snapshot fallback. These paths are
removed. No production query, deployment or database mutation is performed
by this patch package.

## New read contract

- Manifest GET uses scalar metadata and fingerprint columns only.
- No schema initializer, DDL, INSERT, UPDATE, fingerprint backfill, snapshot
  JSON selection, snapshot parsing or snapshot hash computation is performed.
- Missing fingerprint columns permit one metadata-only compatibility SELECT.
- Other query failures fail explicitly; they do not retry using full bodies.
- Required race, prediction and live hashes plus explicit optional hash/null
  columns yield `fingerprintStatus: stored`.
- Incomplete rows yield `fingerprintStatus: unavailable` and null hashes.
  Null here means unverified, not proven absent snapshot data.
- Existing 5,000-row cap remains. This is not a pagination implementation or
  proof of completeness for a database larger than that cap.
- Server errors expose safe codes, not raw SQL or internal exception text.

## Browser safety

- An unavailable descriptor cannot acknowledge sync or release any hold.
- Before a send, an observed unavailable remote identity is held with
  `MANIFEST_FINGERPRINT_UNAVAILABLE`; it is not automatically uploaded to
  repair metadata. Existing hold reasons are preserved.
- Read-only recheck reports the unavailable count within remaining holds.
- The extra count survives reload through the existing diagnostic record.
- A later stored exact descriptor can release a matching hold without POST.
- Old descriptors without the additive status field retain compatibility.
- No Original Prediction, EARLY Signal, marks, diamond/warning evaluation,
  FINAL, results, model metadata, database schema or runtime flags change.
- Previously unheld legacy rows can now become held rather than trigger
  automatic upload. This is intentional conservative behavior, not data loss.

Deploy browser and Worker sources together. Existing clients cached on the
old version cannot apply the new browser-side unavailable-descriptor guard;
refresh the app after deployment. Fingerprint metadata recovery is a separate,
explicitly reviewed future operation, not hidden in GET or automatic sync.

## Verification and remaining work

Tests prohibit non-SELECT queries and snapshot-body columns, including legacy
fallback. A 1,657-row fixture verifies a single scalar read and no accesses to
snapshot bodies. These are mocked contract tests, not a production CPU or
memory benchmark. Production 1102 resolution and actual device behavior must
be checked after deployment. Existing 8/44 hold counts are not reconciled by
this patch and no full recovery claim is made.

Formal KPI: HOLD / Probability: MODEL_HOLD / Production: NO-GO.

## Sources

- https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1102/
- https://github.com/h762-arch/-chass-keiba-lab/pull/269
- User-provided IMG_2507.jpeg and read-only HTTP responses described above.
