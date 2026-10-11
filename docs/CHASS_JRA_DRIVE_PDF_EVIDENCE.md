# Phase118: JRA Drive PDF source to research Snapshot input

Base: 4907056a6f5338c8a0943bb1e06c5944bd420f3a (merged PR178).

## Connection

`adaptJraPdfEvidence` accepts bounded connector-export value arrays from the
date-specific PDF authority: JRA_PDF_MANIFEST, JRA_RACE_RUNNER, JRA_HISTORY.
Do not copy the PDF body back into the central master. Each table consists of
the original header followed by contiguous selected data rows; optional
startRow arguments retain their actual source row numbers (default 2).
Input cells must be scalar; each table is limited to 5000 data rows/50 columns.

The output races/runners/history/identityMap can be passed to the existing
`createPredictionEvidenceSnapshot` bridge with its independently supplied
runId, modelVersion, source revision/availability and cutoff/off timestamps.
This patch does not manufacture these timing declarations. The existing bridge
still marks source authentication, trusted timing and identity proof unverified.

Only an exact single manifest and complete declared runner field are accepted.
Runner context and history race/key/number/name must match. Each PDF runner
requires the five distinct source-native history slots 1..5. Duplicate slots,
orphan history and current/future history dates reject the input.

Temporary PDF horse keys never become canonical identities. Callers must supply
one exact sourceRaceId/canonicalRaceId/sourceHorseKey/horseNo/horseName mapping,
canonicalHorseKey, PASS and an evidenceRef. Confirmed starter state similarly
requires one separately supplied status evidence record. These remain caller
declarations, not authenticated official proofs. Duplicate canonical keys reject.

MM/DD is retained as rawDate in the audit, with no inferred year. Invalid or
missing dates remain null and are excluded from consumable history. Every
unresolved identity, status and date produces a distinct HOLD reason. Unknown
five-slot placeholders never become zero-valued runs. A wholly valid synthetic
input becomes READY_FOR_UNVERIFIED_RESEARCH_SNAPSHOT, never production-ready.

Output uses an allowlist. Current PDF odds/popularity, historical popularity,
raw PDF text and prediction marks are not copied into the DATA tables. Pedigree,
index and additional discovery features are not mapped in this patch. No model
weight, probability, mark, EV, Signal or Freeze is generated or overwritten.

## Real source read

Read-only connector inspection on 2026-10-11 confirmed the date-specific source
and its native headers. Tokyo1R bounded export: manifest A1:Q2, runner A1:Y16,
history A1:AI76. Adapter result: 15 runners, 75 slots, HOLD; canonical identity
unconfirmed 15, starter status unconfirmed 15, history year unconfirmed 21,
history date missing 54. No identity/status associations were invented. The
existing source's Quality PASS describes PDF self-consistency, not canonical
identity, official starter status or pre-off evidence authentication.

Sources:
- https://docs.google.com/spreadsheets/d/1t6dIEcq7Ug3h6ScHEeKudGyx5FIZ-tVqvhAKxp8BBy8/edit
- https://docs.google.com/spreadsheets/d/1dqFySEgG6cYEXIx8BmOw7tPOe7wI90H_No1FRoXlgoI/edit (handoff row342)
- https://github.com/h762-arch/-chass-keiba-lab/pull/178

## Validation and next connection

12 new tests cover the real header format with synthetic rows, Snapshot bridge
integration, exclusion of market fields, unknown/partial/calendar dates,
temporary/unconfirmed identity/status, incomplete fields, cross-race joins,
duplicates, bounds, and original row references. Local full check: 1681 PASS.
The real bounded source read is a HOLD audit, not a successful EARLY Freeze.

Next: obtain independent canonical identity/status and full-date history evidence
(for example the existing rolling authority) and compare a research Snapshot.
Only after source/timing verification should durable isolated storage and an
explicit app consumer be connected. App auto-sync, D1/R2 writes and live model
adoption are not implemented here. The existing decommissioned production Drive
runtime remains decommissioned; this adapter performs no IO. Production
Activation remains NO-GO for this research path.
