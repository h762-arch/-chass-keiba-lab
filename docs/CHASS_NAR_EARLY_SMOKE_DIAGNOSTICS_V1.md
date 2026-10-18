# CHASS NAR EARLY Smoke: safe diagnostics and terminal one-shot v1

## Scope and current status

- Base main: `bcdbc7a0ed946622c22c8a13d77546874eece3d8` (PR #252).
- Adds diagnostic metadata, not a prediction model or a data-repair path.
- Preserves the original app acquisition, `makeSnapshot()` and availability evaluator.
- No real race was acquired for development or verification of this patch.
- The 2026-10-18 Kochi 7R run remains HOLD. Its missing exception cannot be recovered.
- Existing EARLY signals, including frozen marks, diamonds and warning signals, are not changed.
- Formal KPI HOLD / Probability MODEL_HOLD / Production Activation NO-GO remain fixed.

## Why change the execution method

`LIVE_CAPTURE_FAILED` alone cannot distinguish local VM initialization, transport,
HTTP/body processing or app validation. Terminal egress may also be restricted.
Run on a user-controlled terminal with normal access to the configured Worker
origin, instead of repeatedly retrying an execution environment whose access is
unconfirmed. This is a proposed operational switch, not evidence that egress was
the cause of the old failure or that the new terminal has already succeeded.

The existing Patch PR Bridge explicitly forbids `.github/workflows/*` changes.
This patch does not modify a workflow or route around that restriction. A new
GitHub Actions smoke workflow needs a separate reviewed/authorized workflow path.
The existing source-probe workflow is NOT a replacement for this app-based Smoke.

## Safe diagnostics

The runner adds `diagnostics` to reports, including HOLD:

- Fixed phase: input, source read, VM init, request validation, transport,
  response validation/body, app acquisition, receipt validation, cutoff wait or evaluation.
- Started, cutoff, capture-completed, evaluated and finished times when reached.
- Forwarded GET count (maximum one), response-received/parsed booleans, HTTP status.
- Actual app source SHA-256 computed before VM initialization.
- Allowlisted error code or fixed generic category only.

Never emits exception text, stack, raw API body, snapshot, RESULT content, sourceRef,
request URL, credentials, child stderr or private source data. Unknown errors are
`UNCLASSIFIED_ERROR`. HTTP failure bodies can fail schema checks; phase and status
are diagnostic observations, not a claim that the remote API is the root cause.

No response => HTTP status is null. No completed acquisition => snapshot/context
hashes may remain absent; the launcher records null rather than inventing hashes.
`invocationSha256` hashes CLI arguments and is NOT a hash of acquired race data.

## Terminal one-shot procedure (future unseen pre-start race only)

1. Apply and independently audit this patch using the existing Bridge.
2. On a terminal with Node >=20 and Git, use a clean checkout of the actual merged
   commit. Do not put outputs or untracked files inside that checkout before launch.
3. Select one previously unseen NAR race; independently verify today's official
   date, planned post time, current runner count and cancellation status.
4. Substitute those verified values and the actual merged commit in this command.
   This example uses placeholders intentionally; it must NOT be run unchanged.

```sh
node scripts/run-live-nar-early-smoke-once-v1.mjs \
  --race-id 'YYYY-MM-DD|会場|R' \
  --post-at 'YYYY-MM-DDTHH:MM:00+09:00' \
  --expected-runner-count HEADCOUNT \
  --expected-commit MERGED_COMMIT_SHA
```

The launcher verifies a clean worktree, exact expected HEAD and the Worker origin
in `wrangler.jsonc`. It rejects non-current JST dates, post-date conflicts, past
post times and a window with 30 seconds or less remaining before post.
Post time is caller-declared, not authenticated evidence; the unchanged app also
checks the actual acquired payload's pre-start identity/time and result absence.

It then fixes `freezeAt` once at its process clock plus 30 seconds, emits a safe
launch receipt on stderr BEFORE spawning, and invokes the original runner CLI
exactly once. stdout is one final JSON envelope containing the actual runner
report and exit code. Save both streams outside the clean checkout, e.g. in a
separate evidence directory. The launch receipt is not an error message.

Capture limit remains 10 seconds; cutoff waiting remains <=120 seconds; child
process watchdog is 125 seconds. No shell interpolation or retry. GET one time,
same origin, credentials omitted, redirects rejected, VM timers disposed.

The one-invocation guarantee is per launcher process, NOT a durable race-level
deduplication service. Never rerun a failed race manually; a future new race
requires a new explicit operational decision. Do not use historical replay.

## Decision and prohibited actions

- Success requires actual runner stdout `LOCAL_PRESTART_MAPPING_READY` AND exit 0.
- Keep `FINAL5_READY_FULL` / `FINAL5_READY_DEGRADED` / `PREDICTION_HOLD` distinct.
- Acquisition failure, cancellation, count conflict, result presence and timing
  violations remain HOLD. Do not repair input or substitute fixtures.
- No D1/localStorage write, `saveNarEarly`, EARLY Freeze, deploy, merge,
  runtime-flag change or Production activation is performed by these scripts.
- Passing mocked tests is not a live Smoke, input authenticity certification,
  formal KPI approval or proof that all original production errors are fixed.

## Review gates

Audit tests, exact changed-path list, base/tree match, patch SHA-256, clean apply,
gzip/Base64 round-trip and full repository check. After Bridge merge, audit the
actual merged commit before selecting a future live race. New workflow changes,
remote execution and production writes are outside this patch.
