# Phase140.13: read-only mirror integrity, freshness and readiness audit

Base: 7bce0a6f2914c6d740b92958d6f5403af623aced (workflow installation after PR #216).

## Purpose and scope

Automate the checks used when reading the Phase140.12 GitHub status mirror:
expected date, same data commit, matching attempt/manifest/snapshot, payload hash,
capture chronology, freshness, schema readiness and current research governance.
The patch adds only a pure Node audit module, CLI, tests and documentation.
No Worker, writer, D1, wrangler, model, Signal, collection schedule or installed
workflow is changed. No automatic audit schedule or background task is created.

VERIFIED means these mirror checks passed at auditedAt under the selected policy.
It is not certification of live code-22/23 acquisition, complete horse History,
Probability integration, formal KPI or Production activation. acquisitionCertified
is always false; probabilityDecision stays MODEL_HOLD and activation decision
stays NO-GO. The source's actual flags remain visible in observed, including
unexpected true values, which produce HOLD rather than being silently normalized.

## Audit policy

- All expected dates must agree, and snapshotPath/sourceUrl must be the fixed
  status endpoint and date-specific file. Remote arbitrary paths are never fetched.
- The manifest's latest attempt must match the independently read attempt index.
- Envelope version, source, timestamps and hash metadata must match the snapshot.
- Independently recompute SHA-256 over UTF-8 JSON.stringify(payload), without
  sorting keys. This is consistency checking, not a signature or protection
  against an owner recomputing a fully fabricated package.
- Canonical UTC timestamps must be ordered and not ahead of the audit clock.
- Default maximum age: 30 minutes, inclusive. Greater age is SNAPSHOT_STALE.
  Thirty minutes is an explicit operational default, not an optimized threshold
  or a GitHub timing guarantee. A pure-call maxAgeMs can be explicitly selected
  from 1 ms to 24 hours. CLI/bundle input cannot override the default.
- Failed latest capture never falls back to an older snapshot as current data.
- Unavailable source/schema, rejected rows, blocked collector configuration and
  unexpected governance flags yield separate HOLD reasons. A normal closed daily
  window (SKIPPED) does not itself invalidate an otherwise fresh mirror.
- Zero saved races can be a valid observed count. Null and absent counts are
  retained; failures never become invented zero-race coverage.

The default age rule can intentionally HOLD overnight or after delayed Actions
runs. The existing schedule has no guaranteed dispatch time. Inspect the attempt
record or perform an existing manual publisher run to refresh it; do not relabel
an old capturedAt. Original predictions and their timestamps are never edited.

## Direct public-GitHub reader

```sh
node scripts/audit-nar-status-mirror.mjs --date 2026-10-15
```

No args selects today's JST date. The repository and data branch are fixed.
The CLI resolves chass-data once via GitHub, then reads attempt, manifest and
snapshot at that exact commit through fixed raw-content URLs. The result reports
sourceReferenceBasis=GITHUB_BRANCH_RESOLVED. No credentials, write API, arbitrary
URL, DB or production fetch port exists. Each request is GET, redirects are not
followed, reads are bounded to 1 MB and 8 seconds including body streaming.
It uses at most four requests, with attempt/manifest read together. Read errors
produce GITHUB_READ_UNAVAILABLE, without copying exception text.

## Connected-tool / local-bundle route

When the local public-HTTP route cannot access GitHub, use the connected GitHub
reader to resolve chass-data and fetch all three files at that same SHA. Pass:

```json
{
  "commitSha": "<the resolved 40-hex data commit>",
  "attempt": {"...": "complete latest-attempt JSON"},
  "snapshot": {"...": "complete status snapshot JSON"},
  "manifest": {"...": "complete manifest JSON"}
}
```

```sh
node scripts/audit-nar-status-mirror.mjs --bundle /absolute/path/bundle.json --date 2026-10-15
```

The bundle is bounded to 1 MB; this route performs no network or file writes.
Its provenance label is DECLARED_LOCAL_BUNDLE. The file alone cannot prove that
its declared commit actually supplied the objects; the caller must retain the
connected-tool retrieval evidence. It never becomes GITHUB_BRANCH_RESOLVED just
because a bundle claims that label. Bundle fields cannot override request date,
reference clock, age policy or governance decision. Invalid files return HOLD.

Exit 0 means VERIFIED; exit 1 means HOLD or rejected input. Neither changes the
project's model/activation decision. Pure module calls label their commit origin
CALLER_SUPPLIED_COMMIT, and perform no IO.

## Validation and real data evidence

New tests: 25 PASS. Related suites including those tests: 47 PASS.
Full npm run check: 2061 total, 2059 PASS, 2 FAIL due to missing local Chrome,
no skips. Bridge must pass both Chrome tests and the entire regression before
merge GO. Tests cover age boundary, future/reversed clocks, date/ref/hash/envelope
mismatch, failed/latest fallback prevention, missing schema/counts, rejected rows,
governance drift, branch pinning, path injection, bounded HTTP/JSON/stream reads,
CLI rejection and local bundle size/provenance/clock-policy constraints.

The direct HTTP reader returned HOLD/GITHUB_READ_UNAVAILABLE here. Separate
bounded probes to api.github.com and raw.githubusercontent.com timed out.
This does not establish a GitHub outage or a defect in the deployed mirror.
Direct-reader live end-to-end success remains unverified in this environment.

The connected GitHub reader independently resolved and fetched all three real
files at data commit 3be09d3c5296e5d70f2b25de9436cc25f9108807. A local bundle audit
at 2026-10-15T12:38:17.142Z returned VERIFIED, with:
- capturedAt=2026-10-15T12:23:30.974Z; ageMs=886168.
- savedRaceCount=12, rejectedRowCount=0; both schemas ready.
- current code 21, three jobs; dated code-22 trial SCHEDULED for October 18.
- researchOnly=true, formalKpiEligible=false, productionActivationReady=false.

These facts describe that captured response and audit time. They are not a
subsequent fresh capture, scheduled publication or proof of code-22 acquisition.
The Phase140.12 manual run succeeded; a new installed-workflow scheduled success
had not yet been observed during preparation. No merge GO is claimed here.
