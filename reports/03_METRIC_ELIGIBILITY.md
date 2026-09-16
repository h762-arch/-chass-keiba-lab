# 03 Metric Eligibility

Eligibility requires a pre-race record and linked result for outcome metrics. Missing values remain null; reconstructed predictions are excluded.

| Organization | AI win | AI place | TIME | WinScore | PlaceScore | BattleScore | Index_PreRace_Available_Races | Index_Result_Linked_Races | Composite |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| JRA | 2 | 2 | 1 | 0 | 0 | 0 | 24 | 1 | 0 |
| NAR | 41 | 41 | 32 | 19 | 19 | 19 | 81 | 42 | 12 |

`Index_PreRace_Available_Races` counts genuine pre-race index data even when no result is linked. `Index_Result_Linked_Races` is the subset with a linked result. Reports, the ledger, and the v3 analysis-hub block are generated from the same `summarizeHistoricalLedger()` definition.

WinScore, PlaceScore, EV, Diamond, Caution and Composite remain metric-specific. Missing values are not converted to zero and these counts do not automatically promote a model.
