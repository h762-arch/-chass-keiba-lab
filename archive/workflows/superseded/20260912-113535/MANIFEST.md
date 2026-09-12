# CHASS Workflow Archive Manifest

Archived at (UTC): 20260912-113535

## Purpose
過去に適用済みの one-shot hotfix / installer workflow を Actions 一覧から外し、
本番運用 workflow と今後の改善 workflow を見分けやすくするための可逆整理。

## Canonical active workflows kept
- .github/workflows/CHASS-JRA-Integrated-Race-Odds-Cache-Refresh-v2.0.yml
- .github/workflows/CHASS-JRA-Result-Cache-Bridge-v1.0.yml
- .github/workflows/publish-ai-snapshot.yml
- .github/workflows/CHASS-Workflow-Cleanup-Consolidation-v1.0.yml

## Archived files
- CHASS-JRA-Bridge-Continuation-v1.2.yml
- CHASS-JRA-Bridge-Continuation-v1.3.yml
- CHASS-JRA-Bridge-Continuation-v1.4.yml
- CHASS-JRA-Bridge-Diagnostic-v1.5.yml
- CHASS-JRA-Bridge-Final-v1.6.yml
- CHASS-JRA-Horse-Identity-Market-Mark-Hotfix-v1.0.yml
- CHASS-JRA-Horse-Identity-Market-Mark-Hotfix-v1.1.yml
- CHASS-JRA-Horse-Identity-Market-Mark-Hotfix-v1.2.yml
- CHASS-JRA-Market-EV-Consistency-Hotfix-v1.0.yml
- CHASS-JRA-Market-EV-Consistency-Hotfix-v1.1.yml
- CHASS-JRA-Market-Freshness-Final-Odds-Hotfix-v1.2.yml
- CHASS-JRA-Market-Freshness-Final-Odds-Hotfix-v1.3.yml
- CHASS-JRA-Market-Freshness-Final-Odds-Hotfix-v1.4.yml
- CHASS-JRA-Market-Freshness-Final-Odds-Hotfix-v1.5.yml
- CHASS-JRA-Market-Freshness-Final-Odds-Hotfix-v1.6.yml
- CHASS-JRA-Market-Continuity-Hotfix-v1.7.yml
- CHASS-JRA-Odds-Bridge-v1.0.yml
- CHASS-JRA-Race-Odds-Auto-Link-v1.0.yml
- CHASS-JRA-Race-Odds-Auto-Link-v1.1.yml
- CHASS-JRA-Race-Odds-Auto-Link-v1.2.yml
- CHASS-JRA-TIME-Missing-Safe-Fallback-v1.0.yml
- CHASS-Viewer-Market-UI-v3.1.yml
- CHASS-Viewer-Compact-Nav-UI-v3.2.yml
- CHASS-Viewer-Market-TIME-UI-v3.3.yml
- CHASS-Viewer-Date-Availability-v3.4.yml
- CHASS-Viewer-Empty-Date-UI-v3.5.yml
- CHASS-Viewer-Hidden-Bar-Hotfix-v3.5.1.yml
- CHASS-Viewer-Ability-Comment-UI-v3.6.yml
- CHASS-Viewer-Ability-Comment-UI-v3.6.1.yml
- CHASS-Viewer-Ability-Mark-Order-UI-v3.6.2.yml
- CHASS-Viewer-Ability-Mark-Order-UI-v3.6.3.yml
- CHASS-Viewer-Ability-Rank-EV-v3.6.4.yml
- CHASS-Viewer-Horse-Identity-Merge-v3.6.5.yml
- CHASS-JRA-Canonical-Horse-Identity-v3.6.6.yml
- CHASS-JRA-Canonical-Horse-Identity-v3.6.6.1.yml

## Restore
必要になった場合は対象 yml を .github/workflows/ に戻せば再度 Actions から実行できます。
