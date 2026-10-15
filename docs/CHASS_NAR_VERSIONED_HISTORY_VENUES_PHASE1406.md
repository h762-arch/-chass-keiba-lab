# Phase140.6: versioned History venue matching

Base: ded561f55301560c7fa77008c4c7259ecc59bfa6 (Phase140.5).

New `attachNarHistoryIdentity` outputs record
`identity.venueMappingVersion = NAR_HISTORY_VENUES_22_23_V1` inside the hashed body.
This version changes only code 22 to 金沢 and code 23 to 笠松. Other codes
retain their existing interpretation; they are not claimed independently verified.
The existing NAR circuit, month/day, candidate uniqueness and duplicate-episode
checks still apply. This is not full year identity proof or model activation.

Verification reconstructs an unversioned schema-2 identity using the exact legacy
table and emits no new field, preserving its historical hash. A supported version
reconstructs using its recorded rules. Unknown or null versions reject. Changing a
version without updating the physical hash rejects; rehashed rule changes must
also reproduce references and all other identity fields. Hashes are consistency
checks, not signatures: where two rules produce identical references, a fully
recomputed package cannot prove which implementation originally produced it.
Schema-1 History verification is unchanged. Diagnostics choose the same table as
the stored identity; unsupported versions produce a bounded UNAVAILABLE result.

No migration, backfill, deletion, or overwrite is included. Existing saved 3R #9
references remain HOLD under legacy rules. ALREADY_SAVED behavior remains, so a
repeat run does not replace them. Only a new eligible save uses the corrected
version. Existing shared observation records and frozen pre-analysis packs remain
untouched. New identities pass the existing shared-store verification gate.

Scope is History identity matching and its diagnostic projection. The separate
live acquisition/UI venue maps are intentionally outside this patch and still
need a dedicated review before running code 22/23 acquisition. Current code-21
research collection caps and window remain unchanged. TIME predicates and the
nine observed missing TIMES are not changed. JRA-origin held references remain
held. Probability stays MODEL_HOLD, researchOnly true, formalKpiEligible false,
productionActivationReady false.

## Frozen fixtures and regression evidence

The two JSON fixtures were captured with the unmodified implementation at the
base commit before the versioned bridge was introduced. The row fixture is a
complete immutable synthetic 3R snapshot, including outer hashes and pre-analysis
pack. The identity fixture contains two 22/23 HOLD references and original inputs.
They are not reconstructed using the new implementation during tests.

Tests cover legacy verification, corrected 22/23 links, unchanged retained facts,
physical hash changes, unsupported/altered/stripped versions, duplicate episodes,
multiple-year candidates, JRA exclusion, mixed old/new twelve-race verified status
and Viewer readback, compact selected-race diagnostics, and shared-store append
without changing prior observation bytes. Test-only SQLite writes are not
production writes.

Primary references for the 22/23 correction (verified in Phase140.5):
- https://www.keiba.go.jp/KeibaWebSP/TodayRaceInfo/S_RaceList?k_babaCode=22&k_raceDate=2026%2F09%2F22
- https://www.keiba.go.jp/KeibaWebSP/TodayRaceInfo/S_DebaTable?k_babaCode=23&k_raceDate=2026%2F08%2F27&k_raceNo=2

Local full check: 1959 tests; 1957 PASS, 2 FAIL because Chrome is unavailable
(jra-browser-smoke and viewer-nar-ability-browser). Bridge CI must run the full
repository check with Chrome before merge GO. Production readback is pending.
