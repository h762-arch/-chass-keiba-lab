# Wave analysis app V1 — opt-in research UI

Baseline: bd0f84549eb8ede04ddce0ac216b0a8deefd5a2c.

The new card analyzes explicit pre-race input, saves a SHA-256 sealed artifact
in a separate device-local namespace, reads it back, and permits restore/export.
It never calls forecast persistence, writes D1, mutates an EARLY snapshot, or
assigns probability, EV, marks, diamonds or warnings. Existing RVI is labelled
as a legacy research score; it is not used as a Haran fallback.

## Use

Choose **事前入力・分析JSONを読み込む**, supplying `{race,horses}` or
`{input:{race,horses},priors:[...]}`. The current-input button uses an unfrozen
app input or loaded CPSI source only. A frozen prediction is not reconstructed
as a new PRE input. Missing prerequisite metadata is rejected, not invented.
The input uses the existing `race.metricInputFreeze`, `originalEarlyMarket`,
`waveEvidence`, `narWaveScMc`, canonical horse keys and index snapshot contract.
Population must explicitly declare `NAR_FLAT` or `JRA_STANDARD_INDEX`.

All artifacts must match circuit, race, Run, snapshot IDs and timezone-qualified
capture <= cutoff < start; new analysis also requires real `now < start`.
The existing combined core keeps its same-JST-day capture guard. Prior-day
market acquisition is NOT enabled in this increment.

NAR computes its own compatibility SC (FIM .45, CD .30, available weights)
and MC (FW .40, ENT .40, MGD .20). It never imports the JRA FS coefficient.
The existing NAR saved-SC/MC lane remains partial and declares unverified
component coverage. VFS VALUE is unsupported and rejected by source schema.
JRA retains the existing v0.2 formula and authority maturity/coverage confidence.
Source authentication remains false even when the formula and hashes agree.

Modes: full, available weights, market only, structure only, compatible PRE
prior median, then cold start. `priors:null` means **NOT_READ**, not zero records;
therefore no invented 50. An explicitly supplied empty eligible set permits a
labelled 50, with DISPLAY_ONLY influence and no current evidence. The caller's
set and claims are NOT authenticated; this is a research lane only. Prior
semantic version/family/scale/circuit, capture-before-start/cutoff, current
origin, unique IDs and SHA references are checked. PRIOR/COLD_START recursion
is rejected. Registered caller distance/field bands can narrow scope; no new
band boundaries are inferred. Missing MG/CL declares RECOVERY_PENDING even if
an operational diagnostic score is available. This UI does not claim to run a
missing Index Provider recovery routine.

A day bundle `{format:"CHASS_WAVE_INPUT_BUNDLE_V1",sources:[{input,priors}]}`
accepts up to 24 races; errors are isolated per race. Multi-race export/restore
uses `CHASS_WAVE_RESEARCH_BUNDLE_V1`. A saved pending analysis is not reported
as completed input recovery.

## Storage contract

`CHASS_WAVE_RESEARCH_ARTIFACT_V1` holds `contentHash` and `body` containing
engine version, input hash, complete input, explicit prior set, analysis time
and result. Verification recomputes both hashes and the result at the recorded
analysis time. Historical restore is read-only replay, never new PRE evidence.
Storage keys are `CHASS_WAVE_RESEARCH_V1:<contentHash>`; identical resends are
idempotent. The saved selector survives reload and verifies on selection.

The result version is `CHASS_WAVE_ANALYSIS_APP_V1_RESEARCH`. This is deliberately
distinct from the earlier proposed `CHASS_WAVE_ANALYSIS_V1` JSON Schema draft:
this increment follows the existing app's exact race/Run metadata and is not a
claim that the proposed server API/schema has been fully implemented.

## Boundaries still pending

- No Wave-specific Drive producer, automatic Drive write/sync, Worker analysis
  API, batch endpoint or D1 migration is added. Use exported artifacts until
  separately wired; do not imply automatic cloud persistence.
- No Role scorer or new WIN_UPSET/PLACE_TAIL coefficients. Both remain UNKNOWN.
- No independent collector/provider authentication or formal KPI promotion.
- No new historical prior acquisition or authoritative band registry lookup.
- No past EARLY backfill and no results-based PRE reconstruction.

## Sources

- NAR: https://docs.google.com/document/d/1ZCiiNjJBQw5w2gzZ5eMWHOqkRIR7acJlQPeh8hGyj5M/edit
- JRA: https://docs.google.com/document/d/19x-lQG4pSyIyqjM5pkDGVPkbNJxjNqsfaQFRrfN0Bow/edit
- Operational: https://docs.google.com/document/d/1DtUAhZYE8met8bODY0iV9vvzZLfVwj00EOb2RKX0hpU/edit

Tests exercise circuit isolation, all six modes, invalid markets/metadata/POST,
unknown priors, no source mutation, hash/recompute/tamper/idempotency, public
asset closure and a 390px real-browser analyze/save/restore/export interaction.
