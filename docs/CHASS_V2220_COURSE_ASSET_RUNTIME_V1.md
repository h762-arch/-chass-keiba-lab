# CHASS v2.22 Course Asset Runtime v1

Status: **SHADOW / Production pointer unchanged**

## Purpose

Connect the modular `COURSE_DISTANCE_BRANCH` to the already-saved CHASS course authority without reintroducing Google Drive reads into Production runtime.

Architecture:

`Drive canonical research assets -> reviewed static snapshot -> checksum validation -> Course resolver -> Pace Branch handoff`

Production does **not** read Google Drive directly.

## Included PRE-safe assets

- `CHASS_COURSE_PROFILE_V1` -> `course-geometry-v1.csv`
- `CHASS_COURSE_DISTANCE_PROFILE_V1` -> `course-distance-profile-v1.csv`
- selected guard/readiness metrics from `CHASS_COURSE_SAMPLE_COVERAGE_V1` -> `course-sample-coverage-v1.csv`

The files are snapshots of the saved authority, not newly invented course knowledge.

## Explicitly blocked from PRE runtime

- `CHASS_COURSE_HIST_SAMPLE_V1`: result-bearing raw historical runner ledger
- `CHASS_COURSE_FRAME_AGG_V1`: SHADOW only until separate promotion gate
- `CHASS_COURSE_BIAS_SHADOW_V1`: SHADOW only, no fixed coefficient
- `CHASS_COURSE_FORWARD_JOIN_V1`: VALIDATION_ONLY
- `CHASS_COURSE_FORWARD_READINESS_V1`: VALIDATION_ONLY

These remain connected by lineage in the manifest but are not bundled into the PRE resolver. This prevents result/validation leakage.

## Fail-closed rules

1. JRA/NAR authority is never mixed.
2. Multiple route candidates without explicit Layout return `HOLD`, never a guessed route.
3. An explicitly supplied rail/layout that is absent from the saved authority returns `HOLD`.
4. Missing official start detail returns `DEGRADED_TERMINAL`: saved static geometry remains usable, unknown start geometry is not invented.
5. `LONG` first-turn distance never implies slow pace. It emits `DOES_NOT_IMPLY_SLOW` and Pace Branch must combine it with Horse LeadNeed, forward density and Jockey Intent.
6. Banei is specialist-only and cannot enter the generic flat-racing pace model.
7. Every bundled CSV is SHA-256 checked before use.

## Usage

```js
import {resolveCourseContext} from './src/research/course-asset-runtime-v1.mjs';

const course = await resolveCourseContext({
  organizer: 'JRA',
  venue: '東京',
  surface: '芝',
  distance: 1600,
  layout: '標準',
  railVariant: 'A'
});
```

Expected Tokyo turf 1600 result:

- `status=READY`
- `CourseProfile_ID=JRA_TOK_T_STD_A_1600_PROFILE_V1`
- `FirstTurnDistance_m=540`
- `TurnCount=2`
- `FinishStraight_m=525.9`
- `frontPressureGeometryCue=DOES_NOT_IMPLY_SLOW`

Expected Sonoda dirt 1400 result:

- profile identity resolves
- static geometry resolves
- official start detail remains pending
- `status=DEGRADED_TERMINAL`
- no guessed first-turn distance

## Verification

```bash
node scripts/verify-course-asset-runtime-v1.mjs
node --test tests/course-asset-runtime-v1.test.mjs
```

The repository's existing `npm run check` automatically includes `tests/*.test.mjs`.

## Updating the snapshot

Export the three canonical Drive tabs as CSV and run:

```bash
node scripts/build-course-asset-snapshot-v1.mjs \
  --geometry /path/CHASS_COURSE_PROFILE_V1.csv \
  --distance /path/CHASS_COURSE_DISTANCE_PROFILE_V1.csv \
  --coverage /path/CHASS_COURSE_SAMPLE_COVERAGE_V1.csv \
  --out assets/chass/course
```

Review the resulting diff and run the full regression suite before merge. The snapshot builder never fetches Drive itself, preserving the existing Production Drive-isolation design.

## Fuji Stakes regression principle

Course geometry is an input to pace, not a pace verdict. Tokyo 1600's long run to the turn must not suppress a high Front Pressure scenario when multiple horses want forward positions and rider intent increases conflict. The v2.22 Pace Branch still owns the final pace scenario freeze.

## v2.22 Branch adapter

`src/research/v2220-course-distance-branch-v1.mjs` turns the resolver output into the modular Branch contract:

- `branchKey=COURSE_DISTANCE_BRANCH`
- explicit Asset Resolution records
- terminal PASS / reason-terminal / HOLD
- Pace Branch handoff fields
- governance proof: no Production mutation, no Original EARLY mutation, no result/validation leakage, no writes

This is a standalone connection interface for a future Main Router. No existing
Main Router, app, Worker, scheduler or Pace runner calls it in this patch. The
loader uses node:fs and node:crypto, so it is a Node/filesystem module; it cannot
be inserted directly into browser or Worker runtime without a separate boundary.

## Repository adaptation and verification limits

Original ZIP SHA-256:
ab5fcf28b89f755f444187cb55a36fc2ac823e42bf4e69399f2c48101613f064

Original patch SHA-256:
355e55deac2f5f715b1e218acd8b9237b2b7695eda61af9fb80ab07ddd9b8966

The original patch applied and all twelve supplied tests passed. Additional
probes reproduced a contradictory venue/code returning READY (venue Kyoto with
code TOK resolved Tokyo), and mutation of a loaded profile's distance being
used while integrity still said PASS.

The adapted loader fixes required/forbidden manifest roles and file names,
enforces the five false policy flags, rejects duplicate/malformed CSV columns,
and binds profile/geometry circuit, venue, code, surface, layout and rail.
Loaded objects are recursively frozen and only loader-produced instances are
accepted by the synchronous resolver. Venue and venueCode must both agree;
turf rail cannot be inferred merely from a single bundled A profile. Unknown
start detail degrades. Branch race IDs must bind to the resolved venue/code and
a valid calendar date/race number; opaque/numeric code mappings need an explicit
external adapter. Result/historical input cannot enter this PRE Branch.

Coverage handoff is limited to seven static inventory counts. Result/forward
metrics, status/gate messages and free-text notes are not forwarded into PRE.
Specialist handoff explicitly forbids generic flat Pace. No fixed bias or
LONG-to-SLOW rule is introduced.

Checksums mean CSV bytes match the local manifest, not that Drive or racing
authority provenance is authenticated. The bundled manifest preserves the
uploader's source claim; the three bundled CSV byte streams are unchanged.
The Drive master, row authenticity, temporary-copy deletion and official course
measurements have not been independently verified by this patch review. The
builder therefore labels new arbitrary local CSV inputs as origin-unverified
instead of assigning them the archive master's spreadsheet ID.

Every result declares researchOnly, sourceOriginAuthenticated:false, Formal KPI
HOLD, Probability MODEL_HOLD and Production Activation NO-GO. READY/PASS means
only that static course context resolved under this local snapshot contract.
It is not model validity, formal KPI eligibility or production execution
authority. The governance booleans describe this adapter's declared side-effect
contract, not independent proof about an entire upstream or downstream runtime.
Original EARLY and all existing production source files remain unchanged.
