# Phase140.8: read-only stored version diagnostics

Base: 1bf86f8cb720854fb7b8856111c8535adbfd0fe7 (Phase140.7).

## Contract

Add `qualityDiagnostics.races[].diagnostics.versions` only to the existing
opt-in `diagnostics=1` status sidecar. The new pure helper reads already-restored
DATA. It performs no IO, hashing, identity verification, repair, or model calls.
Normal status, Viewer, writer, row restoration and rejection logic are unchanged.
Race reference, DATA, quality, Pack/hash fields, counts and governance flags must
remain unchanged, including when version accessors throw.

Routing and History versions are independent. The helper observes the two stored
fields separately; a current routing field does not imply current History rules.
Known versions are imported from the existing pure modules, not duplicated.
Unknown values and error messages are not echoed into public output.

## Fields

- `schemaVersion: 1`
- `scope: STORED_VERSION_FIELDS_ONLY`
- `status: OBSERVED` when the bounded version projection is available, otherwise
  PARTIAL or UNAVAILABLE. This is not certification of live acquisition.
- `routing.status: LEGACY_UNVERSIONED` and `recordedVersion: null` when DATA has
  no own `venueRoutingVersion` field.
- `routing.status: VERSIONED` and the supported recorded version when present.
  Explicit null/undefined, unknown values and read failures return UNAVAILABLE.
- `history.horseCount`: all horses, including inactive runners, bounded to 30.
- `history.legacyUnversionedHorseCount`: schema-2 identities with no own
  `venueMappingVersion` field.
- `history.versionedHorseCount`: schema-2 identities with the supported version.
- `history.notRetainedHorseCount`: absent/null History or schema-1 History that
  has not retained the identity mapping layer; not a claim that all History is absent.
- `history.unavailableHorseCount`: malformed/unsupported schema, identity/version
  containers, unsupported explicit version or inaccessible fields.
- `history.recordedVersions`: supported versions actually observed, or an empty
  array. Arbitrary raw values are never copied.

The four History counts sum to horseCount. Unknowns never silently become legacy.
The helper's partial status remains inside `versions`; it does not change the
existing quality diagnostic status or race eligibility. Existing row verifiers
still reject invalid/tampered records before this helper sees them; rejected
rows are not resurrected or diagnosed by this change.

Compact retains the full race-level `versions` object even when all unaffected
horse details are omitted. Selected-race compact filters diagnostic details in
the existing way and keeps saved/rejected counts scoped to the date.

## Expected production observation

The previously supplied 2026-10-15 records were saved before version fields were
introduced. They should report LEGACY_UNVERSIONED routing and legacy schema-2
identity counts where those identities are present. This is an expectation to
verify after deployment, not a new production observation from this patch.
ALREADY_SAVED remains unchanged, so redeploying does not create a versioned save.
A future eligible new save may independently expose a supported routing version
and supported History versions when links succeed. Version markers alone do not
prove live code-22/23 acquisition, canonical year identity, complete History,
Probability connection, or production activation.

## Verification

New tests: 11. Related suites: 104 PASS. Full npm run check: 1984 total,
1982 PASS, 2 FAIL because local Chrome is absent (jra-browser-smoke and
viewer-nar-ability-browser). Bridge must run full CI with Chrome before merge GO.
The twelve-race tests use SELECT-only DB access and compare original rows,
status, quality, hashes and flags. They exercise full/compact/selected compact,
legacy/current combinations and injected accessor failure. Frozen fixtures from
Phases140.6/140.7 remain unchanged and covered.

No worker.js, acquisition route, scheduler, D1 schema/migration, wrangler, model,
TIME predicate or Signal changes. No production writes, backfill or collector
extension during preparation. researchOnly true, formalKpiEligible false,
productionActivationReady false and Probability MODEL_HOLD remain.

After Bridge audit, merge and successful deploy, request:
`/api/chass/v1/public/nar-precompute-status?date=2026-10-15&diagnostics=1&format=compact&race=3`
Check savedRaceCount=12, rejectedRowCount=0 and the new versions object. Confirm
post-merge cron separately by its timestamp. Production Activation remains NO-GO.
