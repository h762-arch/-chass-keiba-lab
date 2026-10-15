# Phase140.10: review-only code-22/23 collection plan

Base: 9985266cd879314a313cc43614913603bb754e5c (merged PR #213).

## Verified calendar and current limitation

Official calendar checked on 2026-10-15 JST:
- Code 22 = 金沢: next planned meeting 2026-10-18 (then 19 and 20).
- Code 23 = 笠松: next planned meeting 2026-10-21 (then 22 and 23).
- https://www.keiba.go.jp/KeibaWeb/MonthlyConveneInfo/MonthlyConveneInfoTop?k_month=10&k_year=2026
- https://www.kasamatsu-keiba.com/schedule

These are scheduled meetings, not proof that cards are published or acquisition
will succeed. Recheck official sources before use. The tool validates recorded
references and internal consistency; it never re-fetches or certifies a calendar.

Current wrangler remains code 21 only, daily 2026-10-14 through 2026-10-20,
07:00 to 14:55 JST, at most 3 jobs per invocation, 20,000 ms per invocation.
Waiting with that configuration cannot produce code-22/23 snapshots. Code 23's
next meeting is outside the current trial. It needs a separately reviewed trial;
this patch does not extend the current one.

## Proposed separate, single-venue trials

Run `node scripts/nar-venue-trial-preflight.mjs` to inspect the bundled plan.
No arguments, environment binding, credential, URL, DB or deployment port is
accepted. It reads only two local repository files and writes JSON to stdout.
The new JSON under config/ is not read by runtime or deployment workflows.

The two proposals are independent alternatives to install at different times,
not simultaneous configurations: 22 on October 18, 23 on October 21. Each uses
the existing daily mode with identical start/end dates, 07:00-14:55 JST,
MAX_JOBS=1 and BUDGET_MS=20000. This is a proposed collection window, not a
verified publication time or a promise of pre-race card availability.

MAX_JOBS is a per-invocation attempt limit, NOT a total trial save limit.
Five-minute Cron repeats may eventually save every eligible race at that venue.
There is no durable total-save quota in this patch; totalTrialSaveLimit is null.
Do not describe it as a one-race trial. The existing scheduler, request budgets,
pre-cutoff guards and ALREADY_SAVED semantics are not changed.

The future vars overlay would replace the current collection venue/window; it
must not be deployed early or merged into wrangler as an automatic activation.
For the October 18 proposal, review restoration of the original code-21 trial
through October 20 after that trial finishes. For October 21, review a separate
single-day trial and expiry. The current daily stop/date guards close the window
but do not restore the original configuration automatically.

## Fail-closed planning and execution gates

The tool checks the recorded baseline, date validity, supported versioned venue
pairs, recorded calendar references and the existing run-window boundaries.
Any invalid plan yields HOLD with no usable proposals. PLAN_CHECK_PASS means
configuration planning checks only. executionStatus always remains HOLD,
deploymentReady=false and productionEvidence=false. Changing both a candidate
and its recorded evidence cannot turn this tool into independent source proof.

Before any separate runtime configuration patch/deployment:
1. Recheck actual official schedule and card identity, post time and readiness.
2. Verify current live schema and existing twelve-race readback remain healthy.
3. Review the exact, separate runtime config diff and restore/expiry procedure.
4. Collect only genuinely new eligible pre-cutoff data; do not backfill, relabel,
   overwrite or recreate the October 15 frozen rows.
5. After collection inspect correct venue, routing and History versions separately,
   hashes, rejected rows, immutable rerun, shared observations and held reasons.

This patch changes only a plan, CLI, tests and documentation. No wrangler,
Worker, writer, reader, schema, Cron, model, TIME or Signal change. No live
acquisition or D1 operation is performed by the CLI. Probability MODEL_HOLD,
researchOnly=true, formalKpiEligible=false and Production Activation NO-GO remain.

## Validation

New tests: 10 PASS. Related suites (including the new tests): 87 PASS.
Full npm run check: 2005 total, 2003 PASS, 2 FAIL, no skips. The two failures
are missing local Chrome (jra-browser-smoke and viewer-nar-ability-browser).
MCP dependencies were installed from the existing lockfile before the final run.
New tests cover planning gates, baseline drift, reversed venues, malformed dates,
calendar reference mismatch, separate-trial boundary, window closure and CLI
argument rejection. Bridge full regression with Chrome and independent diff
audit are required before merge GO. No merge GO is claimed by this document.
