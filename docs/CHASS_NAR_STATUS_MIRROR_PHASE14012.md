# Phase140.12: read-only NAR status mirror

Base: 1e9595867af9f64265c5c218e956ed0deb31a22e (merged PR #215).

## Purpose and limits

Publish a bounded, read-only capture of the existing NAR collection-status API
to the existing chass-data branch. This supplies a GitHub-readable fallback when
ChatGPT's web retrieval cannot read the dynamic Worker endpoint. A mirror is a
timestamped copy, not a continuously live response or a production activation gate.

The existing Publish CHASS Chat Mirror v1 workflow already has contents:write
and writes only to chass-data. The connected GitHub app's direct create-file
attempt returned 403; this implementation uses the existing Actions publisher
route instead. Successful scheduled GitHub publication/readback is still pending
until the workflow replacement below is applied and an actual run succeeds.

This patch adds a publisher, its tests, this document and an INACTIVE workflow
template under docs/operations. It does not edit .github/workflows, Worker,
wrangler, prediction modules, D1, migrations, model or collection schedule.
No existing prediction, Original Signal, mark, diamond/warning or TIME is changed.

## Files and capture contract

Run with Node 24:

```sh
SNAPSHOT_DATE=2026-10-15 OUTPUT_ROOT=/tmp/chass-status node scripts/publish-nar-status-snapshot.mjs
```

Blank/omitted date selects today in JST. CLI flags, arbitrary URLs and credentials
are not accepted. The source origin/path is fixed; requests are GET with only an
Accept header and manual redirect handling. One attempt, 15-second deadline
including body reading, 100,000-byte streaming limit, UTF-8 and JSON validation.

Output within OUTPUT_ROOT:
- chat-snapshot/status/YYYY-MM-DD/nar-precompute-status.json
- chat-snapshot/status/YYYY-MM-DD/latest-attempt.json
- chat-snapshot/status/latest-attempt.json

The first file is updated only after a response passes date/shape/count checks.
It retains the payload's actual governance flags, schema readiness, null counts,
quality and datedTrial metadata. CAPTURED means transport/content capture only;
it does not mean schema health, complete research coverage or activation readiness.
Schema-unavailable API responses with null counts can be captured faithfully.

The envelope includes sourceUrl, attemptedAt, capturedAt, readOnlyCapture=true
and payloadSha256. The hash basis is the UTF-8 bytes of JSON.stringify(payload),
with no key sorting. This checks consistency; it is not a signature or independent
proof of source origin. Source timestamps inside payload are preserved as received.

On HTTP/transport/deadline/size/identity/JSON failure, the previous validated
snapshot is untouched and only the dated/global attempt indexes are updated to
FAILED. They never point to an old capture as if it were newly fetched. A new date
failure leaves older date directories intact. Failure reasons are bounded codes;
exception text and response bodies are not copied into failure records.
Writes use temporary-file rename. Output IO/configuration errors exit nonzero.

The CLI exits zero after successfully RECORDING either capture or fetch failure,
so Actions can persist a failure record. Its stdout ok/status fields distinguish
those outcomes. The workflow's final step fails the job AFTER the data commit
when status acquisition or the separate race publisher failed. Capture metadata
updates on every attempt even if the payload itself is unchanged.

## Two-stage installation (order matters)

1. Run the existing CHASS Patch PR Bridge v1 with this patch's four-file allowlist.
   Wait for full regression, Chrome tests and diff audit, then merge.
2. After merge, open the existing workflow in GitHub's editor:
   .github/workflows/publish-chass-chat-mirror.yml
3. Replace its entire contents with:
   docs/operations/publish-chass-chat-mirror-phase14012.yml
   from the merged main, then commit that workflow-only change in GitHub.
4. Run Publish CHASS Chat Mirror v1 manually with date=2026-10-15 and
   track_slug=kawasaki for the first verification. Later the existing scheduled
   slots request today's JST date and the existing all-track setting.

Do not apply the workflow replacement before the code patch: it refers to the
new publisher/test paths. Bridge explicitly rejects .github/workflows changes;
the docs template is inert and will NOT install itself after merging.
No bypass or automatic workflow-file mutation is included. The user's explicit
GitHub edit is needed because the app cannot write the repository directly.

The replacement retains existing schedule slots (08:00-22:45 JST each quarter
hour; actual Actions start times are not guaranteed), branch concurrency and
contents:write. Status capture runs independently of race collection. Race
publisher errors are recorded without preventing status publication. Counting
all staged JSON files allows zero-race status and failure-only publication.
Copying is additive: a failure output contains no replacement snapshot, so the
older file stays on the data branch. The manifest adds statusMirror.latestAttempt
and its stable path while keeping the existing snapshots array.
Branch checks, exact data-path allowlist and pushes remain chass-data only.
No main push, Worker deploy or D1 mutation is included in this workflow.

## Readback procedure and completion gate

Pin reads to the SAME chass-data commit SHA. First read:
chat-snapshot/status/latest-attempt.json

Check requested JST date and attemptedAt/capturedAt. A FAILED attempt, unexpected
date, future timestamp or excessive age must not be described as current data.
Scheduled slots do not guarantee publication; timestamps are always required.
When CAPTURED, read snapshotPath at the same commit, confirm its date/sourceUrl,
capturedAt and payload hash match the attempt index, then inspect payload's actual
schema, saved/rejected counts, datedTrial and governance flags. If FAILED, an older
snapshot may be used only with its original capture time and a stale label.

After first real workflow publication, verify the data branch commit, global
attempt, snapshot, hash and payload. That GitHub readback is the completion gate;
local integration tests alone do not complete deployment.

## Validation

New tests: 17 PASS. Related suites including those tests: 22 PASS.
Full npm run check: 2036 total, 2034 PASS, 2 FAIL due to missing local Chrome,
no skips. The two browser suites must pass in Bridge before merge GO.

New tests cover capture fidelity, unavailable schemas/null counts, payload hash,
failed-capture preservation, first failure, fixed read-only request, redirects,
malformed/oversize input, whole-request and stream deadlines, JST date handling,
invalid CLI configuration and date rollover. Two integration tests execute the
actual template's count/copy/manifest/allowlist/commit/push shell blocks against
local Git repos. They verify zero-race status publication, failure record
publication, retained snapshot bytes, final failure signaling and unchanged main.
These tests use no GitHub token, external push or production writer.

The local publisher was also run against the live public API and captured a
validated response. This proves this environment's GET/capture route at that
time, not an Actions run or GitHub readback. Bridge full regression and both
Chrome suites remain required before merge GO.

Probability MODEL_HOLD and Production Activation NO-GO remain unchanged.
