# CHASS Live NAR EARLY Availability Dry Run v1

Base: `a91228e0766d3f91e6657683b721ad1bf2bccb68` (PR #248).

## Purpose

Close the remaining gap between the already-tested NAR acquisition hook and the
read-only EARLY availability Dry Run.

This script is an **opt-in local smoke runner**. It loads the existing `app.js`
test-only core in a Node VM, performs exactly the existing
`acquireNarEarlyResearchRecord({enabled:true})` acquisition, keeps the returned
record and acquisition `sourceReceipt` in memory, then passes them to the
existing `evaluateEarlyAvailabilityDryRun`.

It does **not**:
- write D1;
- write browser localStorage;
- call `saveNarEarly`;
- execute EARLY Freeze;
- change runtime flags;
- promote Formal KPI;
- enable Probability;
- activate Production.

Formal KPI remains `HOLD`, Probability remains `MODEL_HOLD`, Production
Activation remains `NO-GO`.

## Why this phase exists

PR #247 created the acquisition receipt and Snapshot Mapping, but no normal
runtime caller is enabled by default. PR #248 created a file-based local Dry Run,
but still required someone to supply a genuine `snapshot.json` and
`context.json`.

This smoke runner joins those two read-only sides for **NAR only**, without
adding a production save path.

## Safe execution window

The cutoff is a real declaration, not a timestamp repaired after acquisition.

Run the command shortly **before** the declared cutoff. The runner:
1. validates that the cutoff is strictly in the future and the race is on the current JST date;
2. refuses cutoffs more than 120 seconds ahead;
3. performs one existing NAR race acquisition;
4. if acquisition finishes before cutoff, waits in at most one-second steps until that declared cutoff;
5. evaluates immediately at/after cutoff;
6. returns HOLD if acquisition/finalization crossed the cutoff.

There is no `--now`, replay, historical-success, or result-removal option.

## Command

```sh
node scripts/live-nar-early-availability-dry-run-v1.mjs \
  --base-url "https://YOUR-DEPLOYED-CHASS-ORIGIN" \
  --race-id "YYYY-MM-DD|競馬場|R" \
  --freeze-at "YYYY-MM-DDTHH:MM:SS+09:00" \
  --expected-runner-count "実際のDiscovery頭数"
```

`--base-url` must be HTTPS, except localhost may use HTTP. Credentials, query
strings and fragments are rejected. The VM fetch bridge only permits the same
origin `/api/nar/race` path and the requested date/race query. Base URL paths
are rejected. One credential-free GET is allowed; automatic redirects, bodies,
custom headers, extra query fields and a second fetch are forbidden.

The whole capture (including response body) has a maximum 10-second deadline,
shortened to the remaining cutoff window. The fetch is aborted on timeout and
the report is HOLD. Responses are limited to 1,000,000 UTF-8 bytes and 2..30
runners before app prediction work. A timeout has reason LIVE_CAPTURE_TIMEOUT;
a capture that returns after cutoff remains CAPTURE_COMPLETED_AFTER_CUTOFF.

`expected-runner-count` is not inferred. Use the actual Discovery coverage count.

## Output interpretation

Exit `0`:
- `status = LOCAL_PRESTART_MAPPING_READY`
- mapping is FULL or DEGRADED
- still no freeze/save/Production authority

Exit `2`:
- HOLD
- inspect `reasons` and `degradedReasons`

The report intentionally does not emit:
- raw Snapshot;
- raw API payload;
- `sourceRef`;
- deployment base URL;
- RESULT payload.

The existing Dry Run hashes the in-memory Snapshot/context bytes for binding,
but those hashes are not proof of official origin.
The report also binds the loaded app code with appSourceSha256 and marks
testAppSourceOverride. acquisitionCompleted means the local hook returned and
its receipt was checked; liveCapture is the runner mode, not proof of official
origin. Neither field certifies the server response or its timestamps.

## Review corrections and regression scope

Uploaded ZIP SHA-256:
94b10491817757289b56c11858c4b8e5d0fe3741234c693bdea76bef3a0b257a

Original patch SHA-256:
1301f9c45c29d29d6ab42fe6bcfa0c58e71601e1c48860c6acf973528fc8ead3

The original patch applied cleanly and its eight tests passed, but all eight
used a replacement appSource. Running actual app.js before 09:30 JST reproduced
a surviving pre-odds fallback timer: the runner returned a report but the Node
process remained alive. The original NAR fetch hook also has no request timeout.

The reviewed runner tracks/disposes all VM timeouts and intervals on both success
and failure, before waiting for cutoff. This disables future background app
callbacks without reimplementing prediction. Console output is suppressed, and
all localStorage mutation methods fail closed even if app code catches errors.
Fresh receipt times must lie between runner start and acquisition completion;
backward or non-advancing wait clocks hold rather than extending the wait.

Regression tests execute actual app.js in a child process before 09:30 JST and
require clean process exit, and exercise the actual Response stream interface.
Other tests cover nonsettling fetch/body, abort, endpoint/method/redirect/request
limits, result rejection, storage attempts, clock rollback and bounded waits.
Those tests use synthetic API responses, not a live official acquisition.

## Important limitations

- This is NAR-only because the existing JRA background precompute path does not
  yet produce a completed FINAL/Final5 at its calculation point.
- The local OS clock is not an independently authenticated time authority.
- The source receipt remains a declaration from the existing app acquisition
  path, not cryptographic proof from the racing authority.
- A passing smoke run does not resolve every historical 10/17 error by itself.
  It demonstrates that a new unseen pre-start acquisition can travel through
  acquisition -> sourceReceipt -> Snapshot Mapping -> availability Dry Run
  without persistence.
- Historical 10/17 data must not be reclassified as a new live pre-start success.

## Promotion rule

After a genuine unseen-race smoke run:
1. preserve the emitted report;
2. verify the race was genuinely pre-start and no RESULT was known;
3. compare reported FULL/DEGRADED/HOLD reasons with the original operational
   failure mode;
4. only then consider a separate runtime wiring PR.

No Production Activation is authorized by this patch.
