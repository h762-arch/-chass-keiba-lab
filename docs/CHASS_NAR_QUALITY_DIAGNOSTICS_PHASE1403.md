# Phase140.3: optional diagnostics after status restoration

Base: main 53ac53bd985f4b7b0fd3ab932fbc89e7db23eb4b (Phase140.2 PR #205).

## Public read-only interface

Append `&diagnostics=1` to the existing GET status route:

`/api/chass/v1/public/nar-precompute-status?date=2026-10-15&diagnostics=1`

Only the literal string `1` enables it. Default/0/true preserve the existing
response shape without a qualityDiagnostics key. GET/HEAD restrictions,
no-store caching and all existing run-audit fields remain unchanged.
The Worker passes a boolean to the reader; a custom diagnostic function cannot
be supplied over HTTP. No extra D1 queries or source fetches are introduced.
The same verified DATA already read for status is used.

New top-level `qualityDiagnostics` is a separate sidecar:

- schemaVersion: 1
- status: OBSERVED, PARTIAL, EMPTY, or UNAVAILABLE
- races: [{raceId, diagnostics: <Phase140.2 bounded projection>}]
- reasonCode: only for unavailable batch errors

OBSERVED means the diagnostic projection was observed, not full history,
probability connection or Production Activation. PARTIAL means one or more race
or section diagnostics were unavailable; race-specific detail must be consulted.
EMPTY means no restored races, not successful history coverage. Missing evidence
and unsupported reasons retain null totals. Held references are not horse counts.
Store heldEpisodeCount and identity heldReferenceCount have different meanings.
No raw DATA, arbitrary error text, links or market values are copied to sidecar.

## Failure boundary and integrity

1. Existing snapshot/hash, race identity, History/Rolling and Pack verification
   remain in the row loop. Invalid rows are still rejected; none are repaired.
2. Valid status race objects are collected as before. Optional diagnostics only
   retain references to validated DATA at this stage, without executing it.
3. Schema status and the entire original result are constructed first.
4. Outside both the row-rejection loop and schema/read catch, diagnostics execute
   synchronously. Per-race exceptions produce UNAVAILABLE / DIAGNOSTIC_ERROR.
5. Batch failure is isolated by its own catch and cannot change schemaReady,
   savedRaceCount, rejectedRowCount, races, quality, audits or Pack hashes.

The pure batch helper checks the same-race-reference contract and accepts at
most 500 inputs, consistent with the reader's SQL limit. A test-only synchronous
provider can be supplied through the reader's JavaScript options for fault
injection. Production always uses the fixed pure diagnostic implementation.
Diagnostic failure never makes a valid race disappear. This does not override
row-validation failures or errors that already existed before diagnostics.

No writer, migration, flag, caps, acquisition window, model or Signal changes.
Viewer responses do not gain diagnostics. Phase140.2's offline-only description
is historical; only this optional status invocation is newly connected.
MODEL_HOLD, researchOnly=true, formalKpiEligible=false and
productionActivationReady=false remain in force.

## Evidence and limits

The user-supplied 2026-10-15 status contained 12 races / 141 ability runners /
132 TIME values. Nine TIME HOLDs: R3 #6; R8 #11/#12; R11 #2/#6/#8/#9/#11;
R12 #2. All reasons were time_missing_unknown, without retained count details.
History link HOLDs: R3=3, R7=6, R9=4, R10=18, R11=1 (32 total).
Resolved identity episodes totaled 506; Store unresolved observations totaled
32. These are aggregate observations, not confirmed per-reference causes.
No production DATA was fetched or changed while preparing this patch.
The first production diagnostic response is still pending after merge/deploy.

At 2026-10-15 09:50:18 JST the supplied run audit recorded HTTP 404 on all three
meeting routes and MEETING_SOURCE_UNAVAILABLE, attempted=0/saved=0. The existing
runner returns COMPLETED after processing its events; that is not a successful
meeting fetch. The root cause of those responses is unconfirmed. No route,
retry, source error policy or runStatus logic changes are included. A regression
reproduces three 404s with mock responses while keeping 12 saved races readable.
This is not an independent check of current official NAR endpoints.

## Validation

New regressions cover normal vs optional status equivalence, twelve throwing
diagnostics with SELECT-only access, isolated single failures, replaced-race
results, real public GET/HEAD routing, restored DATA vs Viewer TIME, corrupt hash
rejection, empty/schema-blocked status, batch bounds/errors, three-route 404
preservation and verified schema-v2 ambiguous/unmatched History classification.
All integration fixtures are synthetic; production 9/32 classification remains
unconfirmed until the new optional response is reviewed.

## Next manual gate

After Bridge CI and independent review, merge through the normal user-operated
workflow. Confirm main Workers build, then open ordinary status and diagnostic
status. Both must show savedRaceCount=12, rejectedRowCount=0 and identical races.
Inspect qualityDiagnostics.races for the nine missing TIME observations and
32 History HOLD reasons. Do not label an evidence gap as a proven TIME cause.
Do not treat unknown/unavailable History reasons as zero. Keep live fetch
failures separate from retained data validity.

## Local results (2026-10-15 JST)

- New Phase140.3 regressions: 13 PASS.
- Related nine-file suite: 121 PASS, 0 fail.
- `npm run check`: 1915 total, 1913 PASS, 2 fail.
- Two failures require Chrome (not installed): jra-browser-smoke and
  viewer-nar-ability-browser. Full local check is not PASS; Bridge CI pending.
- All three changed runtime modules pass node --check. git diff --check passes.
- A local-only MCP dependency link was used for testing and removed before
  packaging. No dependency manifests/lockfiles are changed.
- Production diagnostics, production 9/32 causes and 404 root cause remain
  unconfirmed. No production migrations, writes, deployments or merges performed.
