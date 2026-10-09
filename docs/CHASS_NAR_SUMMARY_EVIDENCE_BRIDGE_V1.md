# Phase85: NAR source-native summary evidence bridge v1

## Purpose

Attach previously omitted CurrentLevel, PeakAbility, RecentFormShape,
ConditionTrigger and original summary notes from NAR_近10走サマリー to a
bounded retrospective research snapshot. Phase84 then carries these fields
through the actual consumer trace to each horse's integrated evidence review.
The attachment is an evidence transport, not a trained or approved model driver.

```js
const augmented = await attachNarSummaryEvidence(snapshot, {
  table, source, raceAssociation, identities
});
const output = await reviewNarPredictionEvidence(augmented, baseline, {
  indexPolicy: {...originalResearchPolicy, snapshotHash: augmented.snapshotHash}
});
```

The new function is exported from `nar-summary-evidence-bridge-v1.mjs`.
Existing snapshot data, index/history values, model fields and original evidence
are preserved. A separate FORM_RESEARCH family is appended for each matched
source row. The new content hash binds both original and supplemental evidence.
An explicit supplementalResearch block preserves parent snapshot hash, fresh
capture provenance, identity associations, missing horses and audit refs.
Inputs are unchanged and the output is deeply frozen.

## Identity and bounded capture contract

Only RETROSPECTIVE_ONLY NAR research snapshots with false EARLY/formal/production
authority are accepted. Parent hash and parseable parent off/export times must
match. This v1 deliberately does not support attaching freshly read historical
summary rows to a pre-off snapshot.

The table is at most 99 data rows with unique required headers. Source metadata
requires the same spreadsheet as the parent, exact NAR_近10走サマリー sheet,
nonempty capture revision, firstDataRow >= 2 and an ISO capturedAt no earlier
than off time or parent export time. The timestamp describes this read, not
independently authenticated first availability. Original 更新日時 is retained
literally and cannot backdate acquisition.

Every populated row must have the explicitly associated source race, target
date, NAR organization and exact course. Dates accept canonical YYYY-MM-DD or
integer Google Sheets serial days (1899-12-30 epoch); fractional days and invalid
dates are rejected. No inferred race-ID conversion is used.

Horse number, source horse ID/name and explicit reviewed identity must uniquely
match an active parent horse. This v1 accepts only the existing NAR_ARCHIVE|
source-ID namespace: OP:/OP- identifiers are not silently converted to official
NAR IDs. Different source/snapshot names require an explicit approvedAlias and
reference. Both names remain in the audit. No fuzzy matching, name correction,
duplicate-row selection or unknown status promotion is performed.

保存走数 must be an integer equal to bounded parent history length and <= 10.
Partial captures list missingHorseKeys; they never fabricate rows. Any populated
foreign-race, duplicate or unresolved row rejects the entire attachment.
Repeated attachment and a preexisting FORM_RESEARCH family are rejected.

## Source values versus forecast meaning

The attached values retain source-native summaries and notes, including raw
先行率, 4角平均位置, mixed-distance best TIME and annotated best last3F. Missing,
UNKNOWN, MISSING, HOLD, N/A and 不明 remain null. Valid numeric zero is retained.
No time parsing, cross-distance conversion, automatic class hierarchy, rate
denominator inference, pace projection or signal assignment is introduced.

These are source-declared research judgments, not independently recalculated
ability evidence. In particular, 先行率 is not authenticated 先行実現率 or proof
of first-corner position; 4角平均位置 is not a complete pace scenario. Existing
history-derived clock/position observations remain separate. Pressure and
pedigree are not inferred from form-summary text.

FORM_RESEARCH is currently unsupported by the existing numeric consumer. Its
source values and refs reach the Phase84 horse dossier as available-but-unmapped
features, with SOURCE_FACTOR_NOT_MAPPED. They do NOT become probability/mark,
TIME, interpretation or DECISION_USED drivers merely by being transported.
There is no claim of improved prediction accuracy or production app adoption.

Source refs contain actual sheet row, capture revision and capturedAt. Hashes
establish consistency only. Caller-reviewed identity and source judgments are
not independent source authentication or formal approval.

## Executed fresh Drive read, 2026-10-09

Metadata confirmed CHASS競馬研究所_アーカイブマスター. A bounded read of
NAR_近10走サマリー A1:AL14 captured 13 rows for 20260914_OOI_12 at
2026-10-09T02:24:22.933Z. Their older row update timestamps were not used as proof
of pre-off capture. Existing Phase80 reviewed identities and raw primary history
were reused. No Drive write or production operation occurred.

| Audit | Count |
| --- | ---: |
| Attached horses | 13 |
| Missing horses | 0 |
| FORM_RESEARCH features in actual consumer trace | 13 |
| Horse reviews containing FORM_RESEARCH | 13 |
| Summary probability/mark or TIME effects | 0 |
| Explicit name-alias associations | 2 (horse numbers 4 and 8) |

Existing model after-output remains byte-equivalent to the unsupplemented replay.
Augmented snapshot hash:
`c49660cee3e8089381a18538e4628f5e19c593c5f6bcbf138002069caf0f7c3e`.
Integrated review hash:
`77db0006c68071db4dfe9a7e43abb17b384520a75a86be4db743e3ffa5f6d071`.
Raw captured source, associations, complete augmented snapshot and integrated
review are in the separate audit artifact, not committed repository data.

## Validation and remaining work

12 new tests cover actual consumer/review transport, unchanged model output,
source values/refs, partial capture, missing flags, race and serial-date checks,
strict identity and alias handling, history-count mismatch, late acquisition,
wrong provenance, hash/duplicate rejection and false activation authority.
Related checks, clean patch application and whole-repository Bridge CI are
required before merge.

Original Signal, Freeze, runtime flags, production DB, app code and deployment
remain unchanged. Formal EARLY stays HOLD and Production Activation NO-GO.
Future prediction use requires verifying summary semantics/denominators against
raw history, acquiring missing pre-off evidence with provenance, and evaluating
a separately versioned model on forward-held-out data. This bridge does not
claim those steps are complete.
