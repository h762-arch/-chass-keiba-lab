# PR #265 runtime evidence audit v1

Baseline main: `065852fa52e1a3c27492e0f8f045835406747fef`.

This adds an operator CLI and offline capture comparison. App.js, Worker routes,
deployment, migrations, runtime flags, prediction and sync logic are unchanged.
Scripts and docs stay excluded from public assets by existing .assetsignore.
Every report retains Formal KPI HOLD / Probability MODEL_HOLD / Production NO-GO.

## Read-only probe

From a checkout containing the exact PR #265 browser files:

```sh
node scripts/audit-cloud-sync-runtime-v1.mjs --probe-source . > runtime-probe.json
```

Both local Git blob IDs must match the independently fetched PR #265 tree before
any requests. The command then issues exactly four GETs to the fixed production
origin: app.js, index.html, public health and DB health. Both health handlers use
SELECT 1. No manifest, research, race acquisition, POST, migration, deployment,
token or D1 record access is used. Redirects and credentials are disabled. Bodies
are capped at 2 MB and each request/body operation has a 15-second deadline.
Reports omit raw response bodies and transport error details.

Exact SHA-256 asset agreement proves only those two fetched browser assets match
the baseline. Health proves only its response contract, not Worker source revision
or DB row contents. Device/browser caches may still serve different bytes.
Later browser revisions deliberately fail this PR-specific reference check.

Worker revision requires independent Cloudflare deployment/version evidence.
The existing Production Finalize + Deploy workflow has validate_only, deploy and
migrate_and_deploy modes. This audit does not run it. Version 10.0.1 alone cannot
identify a commit, and merging a PR does not prove deployment.

## Offline capture comparison

Start with docs/CLOUD_SYNC_RUNTIME_CAPTURE_V1.json. The empty template is
intentionally invalid and contains no real evidence. Supply explicit targets and
exactly four captures per race/model: device-before, device-after, d1-before,
d1-after. Use existing operator exports and retain unmodified source files. Do
not create production writes or manufacture missing snapshots.

Each capture has raceId, modelVersion, source, capturedAt (ISO timestamp with
timezone) and record. The normalized record needs raceId, modelVersion, complete
predictionSnapshot, marketSnapshot and finalSnapshot (explicit null if absent). If identity is in an enclosing export row,
copy it verbatim into the normalized wrapper while preserving the original file;
never guess it. predictionSnapshot.modelVersion must also match.

```sh
node scripts/audit-cloud-sync-runtime-v1.mjs --captures private-capture.json > frozen-comparison.json
```

Within device and D1 separately, complete predictionSnapshot, frozen marketSnapshot.signalSnapshot and pre-existing
frozen finalSnapshot objects are compared. Object key order is ignored; array
order, absent fields and values remain significant. A final with warningFrozenAt
is conservatively compared in full. Results, other market fields and queues are outside this
comparator's scope and require separate ledger/manifest review. After-state
device/cloud original equality is reported independently; a differing original
may be an intentionally held conflict. Unchanged originals do not prove sync.
Supplied captures and clocks are not authenticated. Hashing an input identifies
bytes but does not prove provenance. No raw capture is uploaded by this tool.

Exit 0 means only READ_ONLY_PROBES_COMPLETE or COMPARISON_COMPLETE within these
scopes. Exit 2 covers HOLD, malformed input and unavailable/wrong references.
Neither exit code authorizes production, KPI or Probability promotion.

## Remaining runtime acceptance

Do not inject failures or create conflicts in production. Review naturally held
cases read-only; reproduce failure cases using synthetic data in isolation.

| Case | Required evidence | Pass condition |
| --- | --- | --- |
| Browser / Worker pairing | Device-loaded assets, deployment version/source binding | Both match intended revision; health alone insufficient |
| Partial 409 | Request/response, UI counts, target DB rows | Success retained; only conflicting identity held |
| Partial 500 | Isolated failure trace and per-row state | Prior success retained; uncertain row held; unsent tail pending |
| Concurrent calls | Isolated trace with race/model/request identity | One POST for concurrent same-identity calls |
| Reload | Hold panel before/after, network trace | Reason persists; held identity not automatically reposted |
| Manifest reconciliation | Fresh manifest, target and source ledger | Only full descriptor agreement clears uncertainty |
| Original Freeze | Four captures and source ledger | Original prediction and frozen final unchanged within each source |
| KPI boundary | EARLY time/source proof and independent outcome ledger | Separate review; no promotion by this tool |

Keep screenshots, sanitized network evidence and DB extracts outside the public
repository. Preserve request IDs, clocks, race/model bindings; remove credentials
and cookies. A screenshot alone does not prove POST deduplication.

## Validation

46 existing cloud-sync-outcomes tests plus 14 new audit tests passed locally.
VM/mock-D1 and deterministic probes are not real iPhone or production DB evidence.
The full repository check remains a separate Bridge CI requirement.
