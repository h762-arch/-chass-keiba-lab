# Phase140.26: manual read-only source probe runner and workflow template

Base: 10c8f1bef8b659feec8dba614ecea88b3d759619 (merged PR #229).

## Scope and activation boundary

The local environment repeatedly timed out before or during official NAR
source reads. This runner composes the two unchanged existing diagnostics,
retaining their actual outcomes in a single bounded report. A manual Actions
template permits later comparison from a separate execution environment.

CHASS Patch PR Bridge v1 explicitly prohibits .github/workflows/* patches.
Respect that restriction: the template is stored only at
docs/workflows/CHASS-NAR-ReadOnly-Source-Probe-v1.yml. Merging these four files
does NOT register or execute a workflow. Do not change the Bridge allowlist
validator or claim the template is active. No existing workflow changes.

After merge, a repository maintainer can review the template and use GitHub
Add file / Create new file to copy its complete contents into
.github/workflows/CHASS-NAR-ReadOnly-Source-Probe-v1.yml. This is a separate,
explicit repository write, not performed by this patch or the runner. Review
and merge that workflow addition through the repository's normal process.
Only after it is on main can its Actions page offer the manual Run workflow.

Run on main with explicit current JST date, venue code and pre-start race.
For October 16 Kawasaki 1R: date=2026-10-16, code=21, race=1, before 15:00 JST.
Do not replay that example after its post time or reuse the date another day.
No automatic schedule, collector trigger, deployment or D1 access is added.
October 18 code22 remains a separate pending acquisition trial.

Local invocation (same logic, no Actions provenance claim):

```sh
node scripts/run-nar-readonly-source-probe.mjs --date 2026-10-16 --code 21 --race 1
```

## Bounded orchestration and meanings

Accept only six ordered identity arguments; validate real current JST date,
allowlisted code and race 1..20 before GET. No arbitrary URL, credential, save,
historical, clock or timeout CLI options. The API has only fetch/clock/context
test ports; no port supplies fabricated meeting or card outcomes.

First run unchanged preflightNarCandidateCard. On CANDIDATE_CARD_OBSERVED,
stop: status MEETING_TO_CARD_OBSERVED, two GETs, direct check not performed.
Otherwise run unchanged inspectNarDirectCard exactly once as a separate
inspection, not as proof that a meeting gate passed. A positive direct card
produces DIRECT_CARD_ONLY_OBSERVED / MEETING_TO_CARD_NOT_OBSERVED. If neither
can observe a valid card, status HOLD / NO_CARD_PARSE_OBSERVED. Keep nested
reason codes and aggregate evidence so source/identity/post-time failures
remain visible rather than being classified as non-meetings.

Maximum three external GETs: meeting, conditional preflight card, conditional
independent direct card. A failed first-stage meeting normally means two GETs.
Each existing reader retains its default 5-second transport deadline, manual
redirect handling, strict UTF-8 and 1 MB streaming cap. No retries inside either
reader, alternate URLs, next-race sweep, optional result/odds network or global
fetch from parsing. The explicit separate direct check can read the same card
URL a second time after a failed preflight card; it is labeled separately and
never changes that earlier outcome. No synchronous parser CPU deadline is claimed.

The shared finite nondecreasing clock spans both tools, including transitions.
Current JST date is checked initially, inside each tool and on completion.
Each existing parser's strict-before-post gate remains unchanged. A rollover,
clock regression or invalid context cannot yield an overall positive result.

Only MEETING_TO_CARD_OBSERVED exits 0. DIRECT_CARD_ONLY_OBSERVED and HOLD exit
1, deliberately leaving an Actions run red while retaining useful evidence.
Green execution is still not production collection success, persistence,
readback or activation. Always retain MODEL_HOLD, NO-GO, formalKpiEligible=false,
acquisitionCertified=false, currentStatusEligible=false, snapshotCreated=false,
productionSourceChanged=false, workerReplay=NOT_PERFORMED,
savedDataVerification=NOT_PERFORMED and production404Cause=NOT_ESTABLISHED.
collectionStatus and mirrorFreshness remain NOT_EVALUATED; no stale snapshot
is refreshed or relabeled. Original EARLY signals and History/DATA/Pack/TIME
values are neither edited nor repaired.

## Evidence and workflow access

The executable writes only artifacts/nar-readonly-source-probe.json and its
separate .sha256 file. The digest covers the exact UTF-8 JSON file including
its final newline. stdout matches those JSON bytes. Nested request fingerprints
retain DECODED_HTML_UTF8_REENCODED semantics, not raw received-byte identity.
No horse names, scores, TIME values, raw HTML, secret environment, arbitrary
exception text or credentials are emitted. Missing TIME stays missing.

The template is workflow_dispatch only, main only, checkout of github.sha,
contents:read and persist-credentials:false. No secrets, npm install, deployment
or production write tool. Node22 runs existing source directly. Global probe
concurrency is serialized without cancellation, with a five-minute job limit.
always() uploads only the JSON and SHA-256 evidence for 14 days; missing files
cause error. An infrastructure/setup failure can prevent report creation;
absence of an artifact is not a source observation.

Local reports explicitly declare LOCAL_DECLARED and no source SHA or Actions
URL. Actions metadata is validated for repository, main ref, manual event,
40-hex SHA, positive run ID and attempt. It is labeled GITHUB_ACTIONS_DECLARED:
environment variables alone do not authenticate provenance. Independently
match report sourceSha/runId/runAttempt against GitHub run metadata and the
actual checked-out code before accepting an Actions observation. The report
digest detects byte changes but is not a signature or trusted-origin proof.

## Actual local result

One local verification ran 2026-10-16T02:55:13.259Z through
2026-10-16T02:55:22.210Z (11:55 JST), with date2026-10-16/code21/race1.
The meeting preflight timed out after its first GET: HOLD/SOURCE_DEADLINE,
meeting=null/card=null. The separate direct card GET started
02:55:18.264Z and completed 02:55:22.194Z with HTTP200. Existing header and
payload parser gates passed for Kawasaki 1R: post15:00, dirt1400m, 12 runners,
12 active finite ability values and 11 nonempty existing predictedTime fields.
No raw HTML or individual predictions were persisted.

The decoded/re-encoded HTML fingerprint was 95223 bytes and SHA-256
490fc0814301e5d84f2c1e69ab6acb68fb3e00555f6edc8031b65a3c780f5a03.
Overall: DIRECT_CARD_ONLY_OBSERVED, two external GETs, exit1. This is a new
direct card success observation; it does not revise Phase140.25's earlier
timeout. Meeting-to-card E2E, repeatability, GitHub runner success, Worker
recovery, saved snapshot/readback and production failure cause remain
unconfirmed. The manual workflow has not been registered or run in this phase.

## Verification

New tests:21 PASS. Related existing tests:151 PASS; combined172 PASS. Synthetic
fixtures exercise actual existing readers/parsers, success-stop, separate card
only, three-GET cap, no external fallback, unchanged governance, current date,
post and shared clock gates, context validation/privacy, canonical arguments,
correct22/23 routing, exact artifact digest/exit status and template restrictions.
YAML was parsed and trigger/input/permission/timeout structure checked locally.

Full local npm run check:2331 tests /2329 PASS /2 FAIL /skip0. Both failures
require absent Chrome (JRA browser smoke and NAR viewer). Full local suite is
not PASS; Bridge must pass all tests before merge GO. Four new files only:
this document, the inactive template, runner and tests. Runtime/D1/collection
conditions and all existing workflows remain unchanged.
