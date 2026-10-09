# Phase87: summary metric audit in integrated NAR prediction review

## Resulting behavior

The Phase84 `reviewNarPredictionEvidence` entrypoint now recomputes the Phase86
summary arithmetic audit whenever supplemental research is attached. Previously
the summary was visible as an unmapped feature, while its numerical audit was a
separate operation. Now each horse's dossier also includes source/raw-history
reconciliation and field-specific unresolved gaps.

```js
const output = await reviewNarPredictionEvidence(augmentedSnapshot, baseline,
  {indexPolicy: approvedResearchPolicy});
// output.summaryMetricAudit and output.review.rows[*].summaryReconciliation
```

No new caller-authored audit input is accepted. Optional fields such as a forged
`options.summaryMetricAudit` are not consumed; canonical arithmetic is computed
from the validated snapshot. Parent snapshot/consumer/pair/class validation is
unchanged. A snapshot without supplemental research retains the previous return
structure and does not perform summary reconciliation.

## Per-horse record and bindings

summaryReconciliation contains the canonical audit hash, exact snapshot hash,
scope/precision policies, metric status, raw source value, computed value,
sample count, original summary/history refs and the names of arithmetically
matching fields. Each metric is attached by horseKey, never array position.
The race review binds summaryMetricAuditHash, and its reviewHash covers the
complete per-horse reconciliation/gap content. Results stay deeply frozen.

| Metric status | New gap code |
| --- | --- |
| RAW_INCOMPLETE | SUMMARY_RAW_INCOMPLETE |
| NO_RAW_SAMPLE | SUMMARY_NO_RAW_SAMPLE |
| UNVERIFIED_DEFINITION_OR_CONDITION | SUMMARY_DEFINITION_OR_CONDITION_UNVERIFIED |
| MISMATCH_UNDER_AUDIT_POLICY | SUMMARY_NUMERIC_MISMATCH |
| SOURCE_MISSING_OR_NONNUMERIC | SUMMARY_SOURCE_MISSING_OR_NONNUMERIC |
| Summary absent for a horse | SUMMARY_ROW_MISSING |

MATCH_UNDER_AUDIT_POLICY is listed in arithmeticMatches. It does not become
DECISION_USED, a calibrated probability, an independent support, a class/pace
match or authenticated pre-off evidence. modelUse remains NOT_VALIDATED.
The existing FORM_RESEARCH feature still explicitly reports its unmapped model
status. Audit/ref display must not be mistaken for use in numeric prediction.

Scopes retain Phase86's ALL_RETAINED_HISTORY policy, exact-course/distance
grouping without a surface filter, fixed rounding tolerance, null unknown
outcomes and no-sample rates, and deliberate nonvalidation of leading/corner
labels and mixed-condition best clocks. Source judgments remain unverified.

## Executed archival audit, 2026-10-09

Reused Phase85's bounded source capture from 2026-10-09T02:24:22.933Z and the
existing Phase80 identity-reviewed history. No new Drive capture or write,
market acquisition, saved original EARLY prediction, or pre-off proof is claimed.

| Audit | Count |
| --- | ---: |
| Horse dossiers with reconciliation | 13 |
| Summary metrics | 234 |
| Arithmetic matches under explicit policy | 172 |
| Field-specific metric gaps | 62 |
| Raw incomplete / no sample / definition-condition gaps | 4 / 6 / 52 |
| Summary probability/mark or TIME effects | 0 |

Count check: 4 + 6 + 52 = 62 and 172 + 62 = 234. These are correlated metric
records, not independent prediction supports or an accuracy score. Existing
probability/mark/TIME after-output remains unchanged.

Canonical arithmetic audit hash:
`8654a163955a0a37dac411b909a58a3f65c9dc2a17f000714a915e3825149004`.
Integrated review hash:
`b78ca7638dcdf8f3f6a77d3afe3a90ae00a25337387b9000a236b9934fe0bef0`.
The separate audit artifact preserves full source, bindings and output.

## Verification and remaining authority

10 new integration tests verify canonical audit binding, correct horse
attachment, arithmetic-only status, mismatch/raw-incomplete/no-sample/unsupported
definition/missing-source gaps, legacy behavior, caller-audit rejection and
unchanged numeric output/false authority. Related regression and whole-repository
Bridge CI plus exact PR diff audit remain required before merge.

This is a research dossier integration, not production app rendering, an approved
multi-angle model, or validated revised final prediction. No model weights, app
runtime, production DB, Drive, flags, deployment, Original Signal or Freeze is
changed. Formal EARLY stays HOLD and Production Activation NO-GO. Next model
work must use explicitly justified features and separately test forward
performance; arithmetic matches alone cannot authorize promotion.
