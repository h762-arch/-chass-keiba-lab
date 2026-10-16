# Phase140.21: retained venue comparison consistency audit

Base: 448da3caa4b49255d325b44a5bd879998c2def77 (merged PR #224).

## Purpose

Phase140.20 confirmed two retained NAR NO_VENUE_MATCH references for October 15,
race 20261015-NAR-21-03, horseNo=9, episode indices 3 and 4. Its sanitized report
did not validate or display the optional venueCodeComparison payload. This phase
adds a pure consistency audit and projects only recomputed comparison fields.
It changes no production endpoint, mapping table, identity logic, D1, runtime,
collector, schedule, workflow, DATA/Pack, TIME, prediction or EARLY frozen signal.

Existing command after this patch:

```sh
node scripts/read-nar-material-diagnostics.mjs --bundle /absolute/path/bundle.json --date 2026-10-15 --historical --conditions
node scripts/report-nar-material-conditions.mjs --bundle /absolute/path/bundle.json --diagnostics /absolute/path/diagnostics.json --date 2026-10-15 --historical
```

The same four-file scope contains this document, a new research audit module,
the changed condition report and tests. The reader/CLI and production helpers
are not modified. Reader invocations without --conditions retain old behavior.

## Audit boundary

The condition report still first revalidates both raw inputs through unchanged
Phase140.17 acceptance. Then, only retained NAR NO_VENUE_MATCH or
DATE_VENUE_COMBINATION_UNMATCHED references require the new comparison audit.
Other references keep the existing projection and ignore optional extra fields.

The new pure audit clones its input, bounds official references to 1..5, requires
actual calendar dates, normalized two-digit numeric codes, a possible month/day
(including February 29), and allowlisted retained venue names. It reconstructs
the comparison using existing compareNarVenueCodes with each supported historical
table, rather than trusting supplied venue names, flags, counts or conclusions.
All defined comparison fields, reference indices, baseline/comparison names,
mapping-basis labels, booleans, candidate counts, schema and observation must
match one complete recomputation. Unknown numeric codes remain null-mapped and
LEGACY_UNCHECKED; they are not promoted to verified official venue codes.

Official, same-month/day, same-venue and baseline date/venue counts must also
reconcile to the accepted parent reference. Source date/venue flags and the
original mismatch predicate must agree. Strict real-date checks are an additional
report gate, not a change to stored matching or legacy verification semantics.

The sanitized output records baselineCompatibility, not a certified stored
mapping version. It may contain LEGACY_UNVERSIONED, NAR_HISTORY_VENUES_22_23_V1,
or both when references do not distinguish them. baselineVersionAuthenticated
is always false. Recomputing declared diagnostic fields does not prove that they
are authentic saved DATA; the source/transport provenance limits remain intact.

## Report and failure behavior

An applicable CONSISTENT audit is included under the individual retained
History reference, with comparison fact month/day and venue, official code/date
rows and bounded predicate counters. Arbitrary text, names, source URLs, private
errors or extra caller fields are excluded. The report labels
venueCodeComparison=CONSISTENCY_CHECKED only when applicable comparisons exist;
otherwise its existing NOT_EVALUATED label remains.

totals.venueCodeComparisons counts held references and their comparison
observations. Repeated official links or multiple candidate years do not become
extra horses, resolved identities or completed tasks. Original sourceReason,
NO_VENUE_MATCH/DATE_VENUE_COMBINATION_UNMATCHED, HOLD, episode counts, unresolved
tasks, hashes and captured timestamps are preserved.

An applicable absent/UNAVAILABLE comparison causes report HOLD with
VENUE_COMPARISON_UNAVAILABLE. A malformed or inconsistent comparison causes
VENUE_COMPARISON_INVALID. Report races=[] and totals=null prevent partial or
fabricated counts. Base acceptance alone can still be ready; the single-GET
reader propagates report HOLD while retaining its actual CAPTURED transport and
separate acceptance result. This is intentional stricter reporting, not a claim
that a valid HTTP read or prior base acceptance failed.

VERIFIED_CODE_MAPPING_CHANGES_CANDIDATES only states a conditional difference in
the retained candidate predicates. Even one candidate does not prove canonical
year, factual episode equality, unique identity or root cause. Do not relabel
old HOLDs, attach identities, rewrite hashes, migrate DATA, exclude JRA records,
or activate acquisition on this evidence. Existing versioned identity readback
remains unchanged. Probability MODEL_HOLD, Production Activation NO-GO,
formalKpiEligible=false, acquisitionCertified=false, diagnosisStatus=NOT_ESTABLISHED
and taskCompletion=NOT_CLAIMED remain fixed. October 18 code-22 acquisition is a
separate pending check.

## Primary references rechecked

Official Kochi Racing articles link Kanazawa to k_babaCode=22 and Kasamatsu to
k_babaCode=23. Rechecked October 16, 2026 JST. These corroborate the existing
comparison helper's two overrides, not a newly changed production table:

- https://www.keiba.or.jp/?p=127784 (Kanazawa; outgoing NAR entry uses code 22).
- https://www.keiba.or.jp/?p=123585 (Kasamatsu; outgoing NAR entry uses code 23).

## Verification and real-read limit

New tests: 21 PASS. Existing related tests: 224 PASS; combined 245 PASS.
Fixtures use the real diagnostic generator and compact projector. They cover
both verified overrides, legacy/current/ambiguous baseline compatibility,
unknown codes, date/venue mismatch, candidate-year ambiguity, malformed/missing
comparisons, all counter/flag/label contracts, parent-count reconciliation,
bounded dates/references, safe immutable output, full report integration,
reader HOLD propagation and historical source/model gates. Two retained episodes
with repeated official candidates still count as two held references.

Full local npm run check: 2,217 tests / 2,215 PASS / 2 FAIL / skip 0. The failures
require missing local Chrome (jra-browser-smoke and viewer-nar-ability-browser).
The complete local check is not PASS; Bridge must pass all tests before merge GO.

One real --historical --conditions invocation used the unchanged October 15
bundle from fixed chass-data commit bcd7e08c07d8b271869f120ce3df574e653bdf0d.
The fixed public diagnostic GET started 2026-10-15T22:09:16.009Z (October 16,
07:09 JST) and finished 2026-10-15T22:09:24.034Z with READ_TIMEOUT after 8 seconds.
requestCount=1, top-level HOLD, readAudit=FAILED, conditionReport=null. No retry
or successful real venue comparison was established in this phase.

The actual fact venues, codes and comparison candidates for the two production
references therefore remain unconfirmed here. Synthetic fixture results must
not substitute for them. Earlier confirmed History 30 JRA + 2 NAR and TIME 9
counts are separate Phase140.20 observations; this failed read does not refresh
them. A later successful bounded read is required before reporting the actual
venue comparison. Continuous endpoint availability is not established.
