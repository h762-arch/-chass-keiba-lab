# Phase86: NAR source summary arithmetic audit v1

## Purpose and interface

Reconcile source summary numbers against bounded raw history before considering
them as model features. Extend the Phase85 FORM_RESEARCH transport to retain
13 additional native numeric fields: finish/margin means, historical win/top3
percentages, exact-distance/course sample counts and percentages.

```js
const augmented = await attachNarSummaryEvidence(snapshot, attachment);
const audit = await auditNarSummaryMetrics(augmented);
```

The audit validates NAR retrospective research version/flags, supplemental bridge
version and snapshot content hash; revalidates prior history; rejects duplicate
summary families; and retains missing summaries. Source rows and model data are
never rewritten. Each metric has source value, recomputed value, scope, sample
count, original source/history refs, tolerance and status. Results are deeply
frozen and content-hashed. Hashes are consistency, not source authentication.

## Explicit arithmetic policy

ALL_RETAINED_HISTORY_EXACT_COURSE_OR_DISTANCE_NO_SURFACE_FILTER: use retained
history regardless of surface/class, including different venues and obstacle
history where present. This is a descriptive arithmetic audit of the archive,
not a homogeneous ability or current-race model. Exact-distance and exact-course
groups use literal matches only; their rate denominators do not add an implied
surface filter. Source definitions are not independently authenticated.

* Order latest windows by descending date with original history index as tie
  breaker; retain original refs. Use at most 3/5/10 runs without adding missing
  slots or claiming the window is complete lifetime history.
* 保存走数 / 同距離走数 / 同場走数: literal retained sample counts, exact match.
* Mean finish: sum of valid finishing positions divided by actual window count.
  Every outcome needs an integer position within a known field size > 1.
* Mean margin: arithmetic mean only when every selected margin is finite.
* Win and top3 percentages: `100 * matching outcomes / actual scope count`.
  No probability-scale conversion or automatic calibration is performed.
* Finish/margin means tolerate 0.005 (two-decimal half step); percentages
  tolerate 0.05 (one-decimal half step); counts tolerate zero. These are fixed
  audit precision policies, not recovered original spreadsheet formatting.

When an outcome/denominator is missing, status is RAW_INCOMPLETE and recomputed
value null; unknown is not treated as a loss and the denominator is not shrunk
to convenient valid rows. A scope with no observations yields NO_RAW_SAMPLE and
null rate even if the source contains zero. Zero count can still match.
Missing, annotated or nonnumeric source claims remain
SOURCE_MISSING_OR_NONNUMERIC. Plain numeric strings are permitted; percentages
with '%' or other annotations are not silently parsed.

MATCH_UNDER_AUDIT_POLICY means numerical agreement under this explicit policy,
NOT a certified source definition, predictive signal, independent support,
source/timing proof or accurate current-race probability. A mismatch is retained
as MISMATCH_UNDER_AUDIT_POLICY, never silently corrected.

先行率, 4角平均位置, best TIME and best last3F are deliberately
UNVERIFIED_DEFINITION_OR_CONDITION. Retained passage labels, rate denominators,
surface selection and mixed-distance clocks do not establish their original
semantics. CurrentLevel, PeakAbility, form/trigger text and notes remain
source-declared judgments. No pace, class equivalence or ability weighting is
inferred from a numeric match.

## Executed archival audit, 2026-10-09

Reused Phase85's bounded Drive capture from 2026-10-09T02:24:22.933Z, not another
fresh read, plus Phase80's reviewed raw primary history. All 13 summaries for
20260914-NAR-OI-12 were attached with existing explicit alias associations.

| Metric status | Count |
| --- | ---: |
| MATCH_UNDER_AUDIT_POLICY | 172 |
| RAW_INCOMPLETE | 4 |
| NO_RAW_SAMPLE | 6 |
| UNVERIFIED_DEFINITION_OR_CONDITION | 52 |
| MISMATCH_UNDER_AUDIT_POLICY | 0 |
| Total | 234 |

Count check: 13 horses * 18 metrics = 234; 172 + 4 + 6 + 52 = 234.
The 52 unverified metrics are 4 deliberately unsupported dimensions per horse.
No observed mismatch is not proof that all source definitions are verified.
Original current-race probability/mark/TIME output stays unchanged. The newly
transported summary numbers reach consumer trace/review as unmapped research,
not model drivers. No retrospective values are backdated into formal EARLY.

Audit hash:
`8654a163955a0a37dac411b909a58a3f65c9dc2a17f000714a915e3825149004`.
Augmented snapshot hash:
`76a7d2f888bfb59ea56cc8ad515c8e845b7f27e05b294a46a8a0aaea964ddd4d`.
Raw data and complete output are in a separate audit artifact, not git data.

## Verification and authority

12 new tests exercise arithmetic/ref reproduction, mismatch visibility, percent
units, unknown outcomes/denominators, no-sample rates, chronological refs,
unsupported definitions, annotated missing source values, hash/duplicate/future
history rejection, false authority and immutability. Existing summary transport
and full related regression tests remain required, followed by whole-repository
Bridge CI and exact PR diff review.

No app runtime, model weighting, Original Signal, Freeze, Drive write, production
DB or deployment changes. Formal EARLY remains HOLD and Production Activation
NO-GO. Arithmetic audit alone cannot complete validated multi-angle prediction.
