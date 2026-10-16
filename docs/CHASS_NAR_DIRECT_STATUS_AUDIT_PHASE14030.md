# Phase140.30 — read-only direct status capture audit

This offline audit accepts the original capture envelope emitted by
`publish-nar-status-snapshot.mjs`. It does not turn a direct capture into a GitHub
mirror bundle, invent a commit/manifest, refresh a timestamp or execute collection.
Only this document, the new CLI, the pure auditor and its tests change.
Runtime, D1, source conditions, History/TIME, EARLY and existing workflows are unchanged.

## Usage and decisions

```sh
node scripts/audit-nar-direct-status.mjs --capture /local/nar-precompute-status.json --date 2026-10-16
```

The CLI accepts exactly these two options, reads at most 1 MB of strict UTF-8 JSON,
and uses the actual current clock. No URL, token, clock override, historical replay
or production write option is provided. Exit 1 means HOLD or invalid input; exit 0
means a fresh, internally consistent status observation, never acquisition approval.
The API's injected `now` exists for deterministic tests only.

The auditor validates canonical capture schema/source URL, payload SHA-256 over
UTF-8 `JSON.stringify(payload)`, original times, counts and race identities,
quality arithmetic, bounded history counters, latest-run counters and public-field
aliases. Future timestamps hold. The original 30-minute freshness boundary remains
inclusive; older captures retain their observed totals but return HOLD and
`currentStatusEligible:false`. A missing/malformed capture fails closed. A fresh
capture can contain an old run: run age/freshness is reported separately.

SHA consistency and the declared URL do not authenticate the origin. Output says
`DECLARED_DIRECT_CAPTURE_NOT_GITHUB_MIRROR`, `originAuthenticated:false` and
`STATUS_REPORTED_ONLY`. It does not independently read back D1 rows, complete DATA,
pre-analysis Pack, horse identities or full History. It emits bounded aggregates,
race IDs and fixed labels rather than raw payload text or arbitrary event reasons.
Malformed supplied counts hold; absent optional counts remain null, with a known
subtotal and unknown-race count. Unsupported quality versions remain unknown.

Saved-row totals and the latest retained run are separate. A strict, consistent
`SKIPPED / DAILY_WINDOW_CLOSED` record with zero attempts/saves/events is classified
as `EXPECTED_WINDOW_CLOSED_SKIP` only when its JST time is outside the configured
start/stop interval, the date lies in the daily period and status/configuration
aliases agree. That skip neither erases older saved rows nor proves collection
failure or recovery. Other run outcomes are observations, not root-cause diagnoses.
Event count covers only the latest retained record, not full run history.

History link-held and store-unresolved totals can overlap: never add them. Saved
rows are not the expected meeting denominator. All outputs retain readiness HOLD,
MODEL_HOLD, formal KPI ineligibility, acquisition uncertified and activation NO-GO,
including an OBSERVED report with zero reported gaps.

## Actual evidence on 2026-10-16 (JST)

At 15:10:37, a read-only public Worker status GET succeeded. Original capture time
was `2026-10-16T06:10:37.058Z`, payload SHA-256
`eb6afabb1d10526677108119dbae446d4a21ead0981e130b7074d6d917f3fc73`.
It reported five saved Kawasaki rows (5R, 7R, 8R, 9R, 11R), rejected rows 0,
55 runners / ability 55 / TIME 51, active TIME missing 4. Link-held references 24
and store-unresolved observations 24 remain separate, overlapping-unknown counts.
Latest retained run at 15:10:18 reported the expected window-closed skip: attempted
0, saved 0, no events. These totals are status-reported evidence, not new writes by
this patch or proof of the complete meeting, Kanazawa/Kasamatsu acquisition,
probability readiness, or the cause of earlier deadline/404 observations.

The separate GitHub mirror at commit
`60044474f5547db94d380e2876655f51fba339ed` captured at 12:08:24 reported two saved
rows (7R, 9R). Its scheduled publisher run 38843997928 succeeded; that proves that
one scheduled publication, not continued periodic freshness. The retained run at
12:05 reported attempted 1 / saved 0, two ALREADY_SAVED events and ten DEADLINE
events. By 15:10 that capture was stale. The fresh direct capture must not refresh
or replace that mirror's timestamp or eligibility. The change from two to five
status rows does not establish which implementation or network condition caused it.

## Verification

Tests cover hash changes, provenance mismatch, failed/future/reversed timestamps,
exact freshness boundary, immutable input, duplicate/wrong-venue races, malformed
counts, impossible quality arithmetic, absent optional fields, history overlap,
run alias/event validation, inconsistent skip windows/configuration, sensitive
text projection and CLI bounds/options/UTF-8. Run the new tests plus the related
mirror/coverage/run audits and the repository full check. The local full check
requires installed Chrome for two pre-existing browser tests; the Bridge's full
regression must pass before merge GO. Production activation stays NO-GO.
