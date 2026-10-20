# Preserve stored snapshots during legacy migration v1

Base main: `b394b07ac50423cbae5f756849f59df292f2bd28` (PR #276).

## Confirmed behavior

Before this change, `migrateSnapshotRecord` could recalculate market values and replace an existing `marketSnapshot` on a real-odds record whose validation was incomplete. The integrity seal was retained, so a valid record could become a market hash mismatch merely by migration. A synthetic, sealed pre-validation fixture reproduces `verified -> invalid / marketSnapshot` on the base revision. The same fixture remains verified and byte-identical on the patched revision. This establishes a code defect; it does not establish when or how any particular historical record changed.

Migration now retains existing prediction, market and FINAL snapshots even when they are empty/incomplete. If an integrity seal already exists, absent original layers are not reconstructed. Truly absent layers in unsealed legacy data can still be filled as legacy-derived references, without adding a seal. Derived odds/EV/mark/Signal recalculation is removed from migration. Existing result snapshots are retained; only a newly derived legacy result receives synthesized horse rows. Existing schema versions are preserved. Metadata completion reports actual changes and uses existing source dates or the existing deterministic fallback; it does not assign the load time as new evidence.

The audit report additionally records bounded local/cloud hash mismatch fields, chronology classification and the actual timestamp strings selected by the existing integrity verifier. It displays hash errors separately from reversed source timestamps, only for problematic records. The existing verifier and its formal eligibility gates are unchanged. Persisted explanatory fields are sanitized and rendered with escaping. Legacy audit entries without detail remain readable and do not receive invented source dates.

## Latest backup findings

Backup exported `2026-10-20T02:21:11.331Z`: 1,631 races, 9 odds histories, 58 holds; captured audit completed `2026-10-20T01:47:01.894Z`.

Among these 58 held records, local integrity is invalid on six:

- Market hash mismatch only: Ohi 2026-09-14 12R, 09-15 4R/5R, 09-17 11R. Their prediction and FINAL hashes still match their retained seals. The four market/seal/prediction/FINAL bodies match the earlier 09:43 JST backup; the latest diagnosis did not introduce this difference.
- Reversed timestamps, without hash mismatch: Niigata 2026-08-30 8R and Morioka 2026-09-12 1R. Existing identity holds remain applicable.
- The captured cloud integrity error on Kawasaki 2026-09-10 1R was also inspected using one exact-model, read-only hold-audit GET. It is a market hash mismatch, with ordered source timestamps.

The four local market mismatches cannot be repaired by recomputing their seal. The two temporal errors cannot be repaired by changing dates. Their historical mutation path remains unconfirmed. No original market is replaced by a current model calculation or by a different frozen Signal.

## Validation and limits

- Related tests: 48 passed. Twelve new tests cover pre-validation and unsealed preservation, partial source containers, genuine legacy filling, continued invalidity of bad evidence, metadata idempotence, startup, backup import and audit explanations/escaping. The prior static migration guard test is replaced by a behavioral validated-market preservation test.
- Required `npm run check`: 3,724 tests, 3,722 passed, 2 failed because Chrome is absent, zero skipped. Browser tests require GitHub confirmation. This is not a full success.
- Local replay of all 1,631 real backup records: no source-field or whole-record changes under the patched migration. All 58 held records remain unchanged, including the six invalid ones.
- No production write, seal repair, retimestamping, hold clearing, model change, workflow/dependency change, merge or deployment performed. This patch prevents a write path and improves explanations; it does not repair historical mismatches or resolve the 58 holds.

## Rollout

Apply through CHASS Patch PR Bridge v1. Set the resulting draft Ready for review and approve workflow execution if necessary. **Do not merge until CHASS Full Integration Gate v1 succeeds for the current PR head and main base.** A Workers build success does not replace full integration. Keep the full predeploy check. If head/base changes, verify again. Head SHA does not exist until the Bridge creates the PR.

Formal KPI: HOLD / Probability: MODEL_HOLD / Production: NO-GO.
