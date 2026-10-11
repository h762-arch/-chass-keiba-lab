# Phase122: source-empty history and bounded official-card capture

This is an explicit Node research path. It adds no app/Worker/Cron entry point,
Drive OAuth, production database writes, prediction signals or Freeze adoption.

## Source-empty slots

`describeJraPdfMissingHistory(pdfInput)` produces exact row references only if:

- The history export includes date, course, surface, distance, finish, time and
  Raw_PDF headers, and every non-identity cell in that slot is null, blank or UNKNOWN.
- Exactly five distinct slots exist for the same race/key/number/name.
- Runner KnownHistoryRuns and UnknownHistorySlots are nonnegative integers,
  sum to five, and agree with the source-empty count.

`adaptJraPdfEvidence` accepts these declarations through
`missingHistoryDeclarations`. Forged, duplicated or unmatched declarations
reject. Accepted slots remain audited as `PDF_HISTORY_SOURCE_SLOT_EMPTY` with
`declaredMissing: true`; they never become synthetic past runs. A partially
known row with no date remains HOLD. This is export consistency evidence, not
proof that a horse has no additional history outside this PDF.

The official-card evidence builder supplies these declarations automatically
when the source qualifies. Direct adapter calls without declarations retain
legacy HOLD behavior and output shape, preserving previously stored quarantine
artifact replay. Missing coverage or sparse headers never imply empty history.

## Bounded capture

`captureJraPdfOfficialCard({pdfInput, sourceUrl, fetchImpl?, clock?, timeoutMs?,
maxBytes?})` performs one GET to the exact HTTPS JRA accessD path. The default
process clock is captured at request start, full-body receipt and observation.
It uses manual redirects, rejects non-200/redirected/changed-URL responses,
streams up to 1,000,000 raw bytes and races both fetch and body receipt against
an abort deadline of at most 10 seconds. Reader cancellation does not extend
that deadline. It does not retry.

Only HTML with explicit UTF-8 or Shift_JIS charset is decoded; conflicting
charset declarations and malformed bytes reject. Decoded HTML also obeys the
existing 1 MB evidence-builder limit. The receipt includes encoding, raw byte
length/hash and process timestamps; the evidence retains its decoded HTML
hash. Neither hashes nor process timestamps establish authenticated source or
trusted historical timing. Injected fetch/clock are for deterministic testing;
productionActivationReady and formalKpiEligible remain false.

The evidence builder verifies exact PDF race/runner identity and emits starter
status only if receipt and observation are both strictly before the card's
post time. Fetching a past card never restores a pre-off starter-state proof.
Exceptions fail the explicit capture; callers must record a failed attempt and
must not substitute an old ACTIVE status. Returned evidence can be passed to
Phase120 quarantine; the capture receipt should be retained independently.

## Verification

16 new tests cover declared missing versus partial history, legacy shape,
coverage mismatches, sparse exports, forged declarations, byte/deadline bounds,
ignored abort, stalled body cancellation, redirect/URL rejection, charset and
clock failures, and capture crossing post time. Related suite: 65/65 PASS.

Explicit live capture: 2026-10-12 00:16:09 JST, Tokyo 1R 2026-10-11.
164,760 Shift_JIS bytes received within the 10-second limit. Exact joins:
15 horse IDs, 21 full history dates, 54 source-empty slots. Resolution remains
HOLD solely for 15 PDF_RUNNER_STATUS_UNCONFIRMED entries because this was a
post-off capture. Quarantine save/readback succeeds with snapshot null.

This does not connect Drive research evidence to the public app, establish
formal EARLY eligibility, or authorize Production Activation.
