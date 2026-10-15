# Phase140.11: October 18 Kanazawa research collection

Base: 85bd81780459b71d6ec2d54697cffd78e8788fd7 (merged PR #214).

## Scope and source checks

Unlike Phase140.10, this patch changes runtime selection and wrangler vars.
After production deployment it schedules code 22 (金沢) only on October 18 JST.
This is research collection, not Probability activation or formal KPI promotion.
No code-23 trial, date extension, D1 migration, backfill or historical repair.

Official sources checked on 2026-10-15 JST:
- Monthly calendar lists Kanazawa on October 18.
- October 18 RaceList is available, with ten races; 1R is listed at 12:45 JST.
- The official 1R DebaTable header identifies October 18, 金沢, 第1競走.
- https://www.keiba.go.jp/KeibaWeb/MonthlyConveneInfo/MonthlyConveneInfoTop?k_month=10&k_year=2026
- https://www.keiba.go.jp/KeibaWeb/TodayRaceInfo/RaceList?k_babaCode=22&k_raceDate=2026%2F10%2F18
- https://www.keiba.go.jp/KeibaWeb/TodayRaceInfo/DebaTable?k_babaCode=22&k_raceDate=2026%2F10%2F18&k_raceNo=1

Web-page availability is not a successful production Worker fetch. Sources,
cards and schedule must still be checked by the existing runner at acquisition.
At preparation, live October 15 readback: schemaReady=true,
historyStoreSchemaReady=true, savedRaceCount=12, rejectedRowCount=0,
trackCodes=[21], researchOnly=true, formalKpiEligible=false,
productionActivationReady=false. No production write was performed in preparation.

## Date-limited selection and restoration

Three explicit vars enable the narrow override:
- NAR_PRECOMPUTE_DATED_TRIAL_DATE=2026-10-18
- NAR_PRECOMPUTE_DATED_TRIAL_CODE=22
- NAR_PRECOMPUTE_DATED_TRIAL_MAX_JOBS=1

Baseline vars remain code 21, daily October 14-20, 07:00-14:55 JST,
3 jobs per invocation and a 20,000 ms invocation budget. JRA caps are unchanged.
The new pure selector is called for every runner invocation, using its actual
wall-clock JST date, not a delayed Cron event's scheduled date.

On October 18 it REPLACES the venue list with only 22 and uses one attempt per
invocation. It does not append 22 or run both venues. Other dates use baseline
21/3. At October 19 00:00 JST the baseline selection is automatic; actual
collection still waits until 07:00. The overall trial closes after October 20.
Nothing enables Kasamatsu on October 21.

This is a one-day trial, NOT a one-race quota. Repeated five-minute Cron turns
may save more eligible races. Existing queue rotation and ALREADY_SAVED behavior
remain, and no durable total-save counter is added. The existing 20-second
invocation budget, official identity checks, post-time cutoff, pre-write deadline,
snapshot verification and shared-history logic remain unchanged.

Partial/empty override settings, unsupported code or job cap, a date outside the
baseline trial, invalid daily window, changed baseline venue/cap/budget or canary
mode block collection before DB or acquisition. Old saved rows remain readable.
With all three vars absent, the pre-existing behavior is retained.

## Read-only status and verification after deployment

Status trackCodes and effectiveMaxJobs describe the CURRENT wall-clock selection.
datedTrial reports validated date/code, maxJobsPerInvocation=1,
totalTrialSaveLimit=null, appliesToCurrentDate, and SCHEDULED / SELECTED_DATE /
EXPIRED. SELECTED_DATE is a date match, not an active-window or fetch-success
claim. Invalid override settings produce datedTrial.status=INVALID and a blocked
schedule with empty effective trackCodes. Snapshot restoration remains independent.
The requested date still scopes saved rows, not the current scheduling selection.

After Bridge full regression and diff audit, merge/deploy and verify:
1. Main/Workers checks succeeded and October 15 readback remains 12/0.
2. Before October 18: current trackCodes=[21], effectiveMaxJobs=3,
   datedTrial.status=SCHEDULED and target date/code match the reviewed values.
3. October 18 in-window: current trackCodes=[22], effectiveMaxJobs=1.
4. New 22 rows: 金沢 label, versioned routing, separate History identity version,
   verified readback and held reasons. Do not infer complete History or Probability.
5. October 19: code 21/3 restored, trial EXPIRED. October 21: daily date closed.

Rollback the selection by REMOVING ALL THREE dated-trial vars and redeploying.
Do not blank them or remove only one; incomplete configuration intentionally
blocks collection. This restores baseline selection without editing saved DATA.
No migration is required. The patch does not itself dispatch deployment or Cron.
Existing configured Workers auto-build/deploy behavior may apply after merge;
review this as a runtime change before merging, unlike the preceding tool-only PR.

## Validation and remaining evidence

New tests: 14 PASS. Related suites including those tests: 101 PASS.
Full npm run check: 2019 total, 2017 PASS, 2 FAIL due to missing local Chrome,
no skips. Bridge must pass both Chrome tests and the entire regression before
merge GO. Tests cover selected-date routing, UTC/JST boundaries, next-day restore,
window closure, invalid override, one-attempt cap, immutable rerun, unchanged
twelve-race readback, post-off/identity rejection and deadline crossing.
Integration cases are synthetic and do not certify production code-22 acquisition.

researchOnly=true, formalKpiEligible=false, productionActivationReady=false,
Probability MODEL_HOLD, Production Activation NO-GO. Signal Freeze, marks,
diamonds/warnings, model, TIME predicates, schema and existing snapshots unchanged.
