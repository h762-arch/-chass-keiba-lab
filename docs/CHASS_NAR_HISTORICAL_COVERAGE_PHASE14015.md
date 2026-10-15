# Phase140.15: explicit historical coverage without freshness promotion

Base: dd53ad6835b0e87d5f8c5dc57b8dfc023033bd23 (merged PR #218).

## Observed need

At 2026-10-15T14:19:45.624Z the connected reader's latest chass-data commit was
bcd7e08c07d8b271869f120ce3df574e653bdf0d, with capturedAt
2026-10-15T13:35:54.892Z. The default coverage report correctly returned HOLD
with SNAPSHOT_STALE, no rows and null totals. The installed mirror schedule is
08:00-22:45 JST. No overnight refresh or guaranteed dispatch time is implied.

Saved research can still be inspected as historical material. That must be an
explicit request with a separate status, not a changed freshness threshold,
backdated audit clock or relabelled capture. No acquisition evidence is added.

## Default CURRENT mode

The existing invocation remains unchanged:

```sh
node scripts/report-nar-status-coverage.mjs --bundle /absolute/path/bundle.json --date 2026-10-15
```

It still calls the unmodified Phase140.13 mirror audit at the actual clock, with
its inclusive 30-minute default. Stale captures produce HOLD with no projection.
Fresh captures retain OBSERVED, with additive usageMode=CURRENT,
currentStatusEligible=true and freshnessStatus=WITHIN_30_MINUTES. Eligibility is
only for this captured-status coverage report; it does not certify live racing,
expected meeting completeness, model readiness, formal KPI or production use.

## Explicit HISTORICAL mode

```sh
node scripts/report-nar-status-coverage.mjs --bundle /absolute/path/bundle.json --date 2026-10-15 --historical
```

Pure callers select mode=HISTORICAL as an option outside the bundle.
The accepted mirror states are VERIFIED or HOLD solely for SNAPSHOT_STALE with
validated observed metadata. Any other reason, including stale plus governance,
blocked collector, unavailable schema or rejected rows, still returns HOLD.
Future/reversed timestamps, bad hash, mismatched manifest/attempt, failed latest
capture, malformed race rows and contradictory counts cannot be bypassed.

Successful historical output always has status=HISTORICAL_OBSERVED,
usageMode=HISTORICAL and currentStatusEligible=false, even for a fresh capture.
Stale output retains freshnessStatus=STALE, top-level SNAPSHOT_STALE, and the
mirrorAudit HOLD/SNAPSHOT_STALE. capturedAt is unchanged; auditedAt is the actual
new inspection time, with the real age and the unchanged 1,800,000 ms policy.
There is no maximum archival age, but structural and chronology checks remain.

CLI exit 0 means a report was produced (OBSERVED or HISTORICAL_OBSERVED), not
freshness or production approval. Consumers must inspect status, usageMode,
currentStatusEligible and mirrorAudit. Exit 1 is HOLD or rejected input.
No mode/clock/max-age field in the bundle controls these options. Only the exact
optional final --historical flag is accepted. The 1 MB bundle limit remains.
Phase140.14's default-mode description still applies; this adds the explicit
historical exception with a distinct output status.

## Scope and evidence limits

No Worker, collector, D1, public API, installed workflow, refresh schedule,
TIME/History facts, Pack, model, original EARLY Signal, marks or diamonds/warnings
are changed. This is a bundle-only, read-only research tool, with no network or
file writes. No automatic historical fallback or nightly job is added.
Commit provenance stays DECLARED_LOCAL_BUNDLE; retain independent retrieval
evidence. Hash consistency is not a signature. Shared History counters remain
separate; historical material does not establish present runner or market state.
Probability MODEL_HOLD, formalKpiEligible=false, Production Activation NO-GO.
The October 18 code-22 production acquisition check remains separately pending.

## Verification

New historical tests: 16 PASS; related existing tests: 43 PASS; combined 59 PASS.
Full npm run check: 2095 tests / 2093 PASS / 2 FAIL / skip 0. Both failures
require local Chrome (jra-browser-smoke and viewer-nar-ability-browser).
The complete local check is not PASS; Bridge must pass all tests before merge GO.
New tests cover default HOLD, explicit historical labelling, freshness boundary,
old archival captures, unchanged clock/threshold/hash, mode injection, tampering,
failed/future/mismatched captures, combined HOLD reasons, row validation, date
binding, governance and CLI argument/size rejection.

The independently re-fetched fixed-commit bundle above was inspected at
2026-10-15T14:21:40.266Z: HISTORICAL_OBSERVED, freshness STALE, age 2745374 ms,
currentStatusEligible=false, mirrorAudit HOLD/SNAPSHOT_STALE.
The saved set contains twelve races, 141 active runners, active ability gaps 0,
active TIME gaps 9, link-held references 32, store-held episodes 0, unresolved
observations 32; seven races have a review condition. These are historical
captured counts, not a new Worker readback or complete History certification.
