# Phase140.33 — current viewer readback against research mirror

This phase adds a reader/auditor, CLI, tests and this document only. Publisher,
runtime, D1, collection settings and workflows do not change.

## Scope

Phase140.32 checks projected files for consistency but cannot recompute the full
viewer hash from those files alone. This phase first audits that original bundle,
then reads the current saved NAR public viewer once. The existing bounded reader
validates the full viewer response and computes SHA-256 over UTF-8
`JSON.stringify(viewerPayload)`. This is the declared hash basis, not raw HTTP
bytes, a D1 snapshot hash or a canonical JSON standard.

The observed full-payload hash must equal the research mirror's declared hash.
The newly projected research data must also deeply equal the published day JSON,
except for their separate capture timestamps. A changed field that the projection
omits (including History) still changes the full hash. Consistently edited scores
in day/race files can pass Phase140.32 but fail this independent projection check.
A legitimate newer viewer can also differ: `VIEWER_PAYLOAD_CHANGED` means HOLD,
not proof that either saved dataset was corrupt. This tool never repairs a mirror.

## Use

```sh
node scripts/read-nar-research-viewer.mjs --bundle /local/bundle.json --date 2026-10-16 --slug kawasaki
```

Use the same fixed-commit bundle as Phase140.32. The CLI accepts only these three
options, reads at most 4 MiB of strict UTF-8 local JSON and uses the real clock.
There are no arbitrary URL, token, historical replay, clock override or writer
options. The bundle is cloned before the asynchronous read to prevent later caller
mutation. Its commit remains a caller declaration; the offline bundle is not
independently authenticated by this tool.

A non-VERIFIED Phase140.32 bundle causes HOLD without network access. An eligible
bundle enables exactly one fixed HTTPS GET to the existing public NAR JSON day
viewer. The existing reader supplies a 15-second whole-request timeout (including
body reading), manual redirects, no retry, a 4 MiB declared/streamed response bound
and strict UTF-8/JSON/schema/governance validation. API dependencies and clocks are
injectable for tests; the CLI exposes no such overrides. Errors emit only fixed
reason codes, never raw errors, URLs containing credentials, horse names or History.

The mirror is re-audited with the actual clock after the GET. If it expires during
the read, it remains HOLD. Original publication times are never refreshed by the
newer viewer read time. Reversed/invalid clocks hold. A successful report contains
both `publishedCapturedAt` and `viewerReadAt`, actual hash/projection verdicts,
counts and the fixed scope labels. Exit 0 means this narrow readback comparison
verified; HOLD/errors exit 1.

## Limits that remain

MATCHED_CURRENT_VIEWER_PAYLOAD proves agreement with a current saved-viewer read,
not a historical HTTP capture, original pre-start acquisition, source cutoff,
EARLY freeze, full D1 DATA/History/Pack validity or full-meeting completeness.
The existing public viewer performs restoration checks, but this tool does not
independently access D1 or reverify all upstream historical evidence. It never
collects a race card, executes the collector, recalculates TIME, fills absent TIME,
changes a signal, trains a model or imports post-race information into EARLY.
Readiness stays HOLD, formal KPI ineligible, acquisition uncertified,
MODEL_HOLD and Production Activation NO-GO in every result.

## Validation

Tests cover hash/projection matches, omitted History changes, consistent projected
edits, immutable input, gate-before-GET, expiry during GET, HTTP/body/schema failures,
timeouts, safe errors, clock behavior and CLI bounds/options. Full repository
regression remains required; two pre-existing local browser tests require Chrome.
Real readback must be reported using actual time and status. A local read success
does not prove this CLI has executed inside GitHub Actions or enable deployment.

## Observed real readback

At 23:38:21.679 JST on 2026-10-16, the local CLI read the actual public viewer and
returned VERIFIED against fixed data commit
`0176907d160525bd39824116fd4a7132f235d666`. The publication capture stayed
23:33:00.661 JST. The full payload hash matched
`677ffb38191c25a85c7a391ba0aa523a1573099f77d782433be88b5701cfab27`, and the
projection matched after excluding only the separate capture times. The report
contained five races, 55 horses, ability 55 and TIME 51. This is a current saved
viewer comparison at that time, not proof of pre-start acquisition or EARLY freeze.
