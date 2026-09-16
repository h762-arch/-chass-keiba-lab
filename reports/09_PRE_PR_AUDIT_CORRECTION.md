# 09 PRE-PR Audit Correction

## v1 defects

- unresolved originals were copied into `Normalized_Race_ID`
- serial date `46273` was treated as text
- 2026-09-08 Kawasaki races 2 and 3 were split between prediction and index sources
- organization values were not fail-closed
- report and hub used the same label for different index counts

## v2 correction

- `normalizeAuditDate()` supports valid ISO, locale, YYYYMMDD, and Google/Excel serial dates
- invalid or ambiguous dates return null
- source fields are resolved by header name
- organization permits only JRA/NAR; invalid values become null
- unresolved rows keep `Original_Race_ID` and a blank normalized ID
- aggregate/day rows are audit notes and do not count as races
- normalized identities merge source presence with provenance retained
- index counts are split into pre-race availability and result-linked availability

## Readback

| Check | Result |
|---|---:|
| Source rows | 135 |
| Ledger rows | 131 |
| Normalized races | 126 |
| Unresolved source rows | 5 |
| Aggregate/day notes | 2 |
| Conceptual duplicates resolved | 2 |
| Malformed normalized IDs | 0 |
| Duplicate normalized IDs | 0 |
| Serial-date remnants | 0 |
| Invalid organization values | 0 |

No source prediction/result/index/validation tab was modified. Only Work-generated audit derivative tabs and the audit block in `CHASS_分析ハブ` were regenerated.
