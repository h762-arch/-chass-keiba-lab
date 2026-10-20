# Protected cloud difference diagnosis v1

Base main: `f2bb2489084202551411f93b3fcb9ea260bb0a95` (PR #275).

## Problem and change

The existing `referenceOnly` category could include different snapshot integrity seals, live assessments and scratch evidence. This could make a protected evidence difference look like an operational validation difference. The diagnosis now distinguishes Signal (including frozen/provisional/legacy snapshots), snapshot integrity, and live/scratch differences. Identity and original prediction conflicts retain precedence. Missing and altered Signal snapshots are both explicit; no replacement winner is selected.

The existing user-triggered “保留の差分を確認（送信なし）” operation remains GET-only. Its report now includes up to 24 changed field paths (180 characters each; traversal depth 6), local/cloud integrity classifications, and the first binding failure side and code. It stores no raw compared values, original snapshots, horse names or marks. The UI displays a dated category summary for currently active holds, and expandable field paths that wrap on a phone. “ハッシュ一致” is explicitly separate from authenticated formal EARLY eligibility.

Older persisted `referenceOnly` reports with seal/live differences are relabelled using their recorded fields and retain their original timestamp. This is not a new network diagnosis. All persisted diagnostic additions are bounded and sanitized. Counts in a new diagnosis are regenerated from actual comparisons.

No original record, race payload, prediction, result, validation flag, queue, integrity seal, frozen Signal, hold or pending state is edited. No hash algorithm, synchronization acknowledgement, hold-clear condition, workflow or dependency changes. No production writes during development.

## Evidence and remaining holds

The backup exported at 2026-10-20T00:43:21.798Z contains 1,631 races, 9 odds histories and 58 holds. All 58 exact model cloud hold-audit records were read. The new classification on that snapshot is:

| Category | Count |
| --- | ---: |
| Integrity metadata difference | 37 |
| Reference validation / operational state only | 2 |
| Signal difference (this record is frozen locally) | 1 |
| Original prediction / market / FINAL conflict | 13 |
| Identity problem | 5 |

All 40 previously refreshed validation fingerprints match the corresponding fetched validation JSON. This is a read-only content comparison, not a raw production SQL inspection. The 37 seal differences cannot be removed by dropping local proof. The frozen Signal difference cannot be removed by adopting a cloud record that lacks it. Neither timestamp order nor matching self-contained hashes authorizes choosing one of the 13 conflicting original captures.

The real-backup VM replay makes 58 simulated GETs against captured responses. It confirms the above counts, no POSTs, byte-identical local records and unchanged holds. It does not run on the user's iPhone or write to production.

## Validation and rollout

Related audit tests: 26 passed, including 8 new cases for protected categories, precedence, bounded paths, persistence sanitization, legacy relabelling, source immutability and formal HOLD boundary. Required full repository check: 3,712 tests, 3,710 passed, 2 failed due to absent Chrome, zero skipped. Both browser tests require GitHub confirmation; this is not a full success.

Apply the supplied patch through CHASS Patch PR Bridge v1. Make the resulting draft Ready for review and approve workflow execution as needed. Wait for CHASS Full Integration Gate v1 to succeed for the current PR head and main base **before merging**. A Worker build check is not that gate. Do not merge while the gate is pending or failed. Keep the full predeploy regression check.

After verified rollout, open the existing sync-hold details and run the diagnostic button once, then export a backup. This patch intentionally does not clear any holds. Original conflict resolution requires independently justified source provenance.

Formal KPI: HOLD / Probability: MODEL_HOLD / Production: NO-GO.
