# Saved / public / similarity read integrity batch v1

Base PR #263: ca443c15e3ec343650df23a43d8c07b731c9c6fa.
Verified tree: 2f7825b18d1ddd5c4f56eea4a42d765dfafd921a.
Prior GitHub Bridge CI: 3432/3432 pass, 0 fail, 0 skip.

## Shared ownership, not another prediction engine

original-record-reader-v1 is a pure module shared by Worker saved-row
serialization, AI/public readers, and Similarity Intelligence.
Prediction owns identity, ability, probability, TIME and ability axes.
Market contributes named market/signal display fields only. FINAL contributes
selection fields only. Frozen signals, explicit empty signals, pending status,
warning-only freeze and warning exclusion retain PR #263's read behavior.
The Worker alone normalizes its public axis aliases.
No prediction calculation, sealing, I/O, automatic signal assignment or data
repair is implemented in the shared reader.
Browser app.js remains separate and unchanged; its existing cross-reader Signal
contract tests continue to run. The ownership inventory declares Worker and
localServer reachability and forbids adding this module to the browser lane.

## Serialization and writes

Derived prediction rows and snapshot_json now use the shared projection rather
than a full Market spread. Explicit market nulls do not resurrect stale values.
Raw prediction_json, market_json, final_json and saved seals are not rewritten
by projection. This is future serialization behavior, not an existing-row repair.

Explicit Prediction identity conflicts and incompatible Market/FINAL/Result/
Validation/Live bindings reject serialization. saveD1Record checks binding
before schema or database access. Sync preflights every incoming binding before
starting its per-record saves. A later stored-Prediction collision returns
conflict/written=false instead of updating a different frozen Prediction's
derived rows. The comparison uses full stable JSON equality, not a short hash.
The sync endpoint reports conflicts and HTTP 409 instead of ok=true.
An existing fully frozen Signal must match its complete saved JSON before any
update can proceed. Missing/pending/relabelled/reason-changed Signal inputs
conflict instead of replacing it. A warning-only freeze protects its timestamp
and warning fields while allowing later full Signal completion that preserves
those warnings. Matching Signal permits independent bound Result updates.
Per-record saves remain sequential, not an atomic multi-record transaction.
Binding preflight does not promise transaction atomicity for later DB failures
or stored-row conflicts; records/written/conflicts report partial outcomes.

No real D1 or localStorage writes were run for this work. Tests use fake D1.
No migration, write API enablement, production configuration or deployment.

## Reader status and dataset eligibility

Explicit outer race/model/organization or nested race disagreement holds the
Prediction view with no horses, Result, Validation or Live output. Public race
responses expose readIntegrity reason codes; a held view can return HTTP 200
with empty horses and HOLD metadata. Day views already omit empty predictions.
Queue status alone cannot establish result_fetched/validated. Nonterminal queue
states remain visible; a disabled queue stays prediction_saved.
The nested pending status uses the same evaluated status as the enclosing race.

A complete read-result order needs at least three unique positive integer horse
numbers belonging to the saved Prediction when that runner set exists.
Unknown/blank/zero finish positions are excluded from D1 result reconstruction.
Dataset binding/complete-order failures are excluded from eligible counts.
Reconstruction remains legacy reference data, not authenticated source evidence.
Volatility metrics require a known index and all three actual-top3 popularities;
sampleSize counts actually evaluated rows, candidateSampleSize shows candidates.

## Similarity boundaries

Original feature extraction uses the shared reader. Future or malformed Market
timestamps are ignored when Prediction time is known. Missing legacy Market time
remains compatible; this is not a proof of pre-start acquisition.
Prediction and Result snapshots own their timestamps ahead of mutable outer
metadata. Historical candidates must satisfy prediction < result < target.
Candidates use the target's exact model version and do not cross explicit JRA/
NAR organizations. Retrospective/backtest exclusions remain in place.
Identical keyed duplicates count once. Differing copies with one race key are
conservatively excluded; JSON property-order differences can also hold a group.
Missing numeric inputs/axes/ranks do not become zero-valued failure evidence.
Walk-forward totals remain descriptive across targets, with each target's
history filtered to its model; they are not a common formal EARLY cohort.

## Verification and remaining work

New tests cover shared ownership, raw-byte preservation, frozen serialization,
binding rejection before DB access, immutable-Prediction conflict and HTTP
reporting, frozen-Signal/write conflict and warning-only completion, result
status/completeness, null-position reconstruction, volatility
missingness, public hold metadata, similarity timing/model/organization/duplicate
boundaries and missing-data pattern behavior.
Two older fixture identities are corrected to match their intended race/model;
the older wrong-result serialization test now requires rejection before writing.

The architecture inventory has 183 sources / 74 prediction / 80 research /
17 declared features, with no runtime missing references or policy violations.
Reachability is not deployment or runtime-success evidence.

Next priorities:

1. Real evidence/result ledger copies, target list and provenance are required
   for original-versus-saved-versus-public log comparison. This audit is incomplete.
2. Audit every caller's display/retry handling for partial sync and conflict
   responses, and legacy model selection/reconstruction semantics with real data.
3. Authenticate acquisition/source and durable pre-start time independently.
4. Only then evaluate win-vs-place selection, Final5 coverage, CPSI uncertainty
   and outlier-resistant return metrics on unseen prospective races. No accuracy
   improvement, 100R completion or formal model adoption is claimed here.

No live race capture, old Smoke retry, synthetic replacement of a real Smoke,
historical replay, EARLY Freeze, saved-signal regeneration, runtime flag change,
merge or deploy. Original live failure resolution and deployed revision are
unverified. Formal KPI HOLD / Probability MODEL_HOLD / Production NO-GO.
