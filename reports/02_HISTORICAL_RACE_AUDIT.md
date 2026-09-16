# 02 Historical Race Audit

Drive metadata search surfaced 32 CHASS-named files/folders. The archive master was audited across current and legacy prediction/result/validation/index tabs.

PRE-PR v2 readback separates source rows from normalized race identities:

- source rows audited: 135
- ledger rows after aggregate exclusion and identity merge: 131
- normalized races: 126
- unresolved source rows: 5
- aggregate/day rows excluded from the race denominator: 2
- conceptual duplicates resolved: 2
- duplicate normalized IDs after merge: 0

| Organization | Total | Pre-race | FINAL | Result linked | Validation | FULL | PARTIAL | REFERENCE | INDEX_ONLY | UNUSABLE |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| JRA | 42 | 22 | 9 | 7 | 11 | 0 | 22 | 3 | 12 | 5 |
| NAR | 84 | 55 | 35 | 45 | 45 | 21 | 34 | 0 | 29 | 0 |

Five race-shaped legacy source rows could not be normalized without guessing and remain review-required with a blank `Normalized_Race_ID`. Two day/aggregate rows are retained as audit notes, not races. Original IDs and multi-source provenance are preserved.

`2026-09-08 川崎2R/3R` prediction and index rows now converge to one identity per race. Google/Excel serial `46273` normalizes to `20260908`. Organization values are restricted to `JRA`, `NAR`, or blank.

Known limitation: non-master Drive artifacts were inventoried by metadata but were not bulk-imported. They remain `NEEDS_REVIEW`; this prevents unverified timestamps from entering calibration.
