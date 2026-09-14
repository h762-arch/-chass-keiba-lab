# CHASS KEIBA LAB Ver.10.0.1
# INTEGRATED OPTIMIZATION FINAL REPORT

## 結論

INTEGRATED OPTIMIZATION MASTER PROMPTのPHASE 0〜7を完了した。現行バージョンは`10.0.1`のまま維持する。今回の統合作業では予想ロジックの本番係数を変更せず、状態分離、UI、Snapshot/D1効率、Public Read-Only API、外部研究Archive、穴馬Scenario、TIME/確率較正研究を段階的に追加した。

最終Full Checkは **275 / 275 PASS、fail 0**。

## Phase完了一覧

| Phase | 内容 | 状態 |
|---|---|---|
| 0 | Current Source Audit | 完了 |
| 1 | Core Stability / Data Integrity | 完了 |
| 2 | UI Compact & Visibility | 完了 |
| 3 | Race Snapshot Cache / D1 Optimization | 完了 |
| 4 | Free Public Read-Only Prediction API | 完了 |
| 5 | JRA/NAR Research Storage | 完了・外部同期は既定OFF |
| 6 | Longshot Scenario Intelligence | 完了・Shadow Mode |
| 7 | TIME / Probability Calibration Research | 完了・Shadow Mode |

## Core fixes

- JRA/NAR切替・raceId変更時の一時状態を分離。
- 未出走レースへ以前のResult、馬場、実走TIMEを残さない。
- Result Recoveryを取得中・成功・待機・失敗へ分類。
- 発走前Result Fetchを既知postTimeで防止。
- Background Collectorの0件理由を分類表示。
- 保存済みPrediction / Result / Validationは削除していない。

## Scratch recalculation removal

新規Scratch処理は`runnerStatus`更新だけとした。

- Original Prediction fingerprint不変
- 他馬AI勝率・TOP3率・印・EV・💎・⚠️不変
- 取消馬はValidation母数から除外
- オッズ欠損だけでは取消判定しない
- legacy Live Adjustmentは読取互換として保持
- 新規Live Adjustment Snapshotは生成しない

## UI changes

- Race Summary、Horse Card、Validation KPIをスマホ向けに圧縮。
- 能力順位と市場順位、現在人気・単勝オッズを明確化。
- predicted/input/live/final oddsを区別。
- Horse Detailの空表示を防止し、確認可能データだけで短評を生成。
- 375 / 390 / 393 / 430px向けの横幅制御を維持。

## Cache / D1 optimization

- 同一Snapshotの再保存はIndexedDB write、Cloud POST、D1 writeを0にする。
- Odds値・人気が同一なら研究Snapshotを変更しない。
- 単一レース同期後の`/api/db/research`全件再取得を廃止。
- 起動時はhealth＋軽量Manifestを読み、研究全件読込を遅延。
- Manifest用fingerprint列を追加し、巨大Snapshot JSON readを削減。
- Migration `0003_race_fingerprints.sql`はADD COLUMNのみ。

## Public Read-Only API

追加済み:

- `GET/HEAD /api/chass/v1/public/health`
- `GET/HEAD /api/chass/v1/public/latest`
- `GET/HEAD /api/chass/v1/public/recent`
- `GET/HEAD /api/chass/v1/public/races`
- `GET/HEAD /api/chass/v1/public/race`
- `GET/HEAD /api/chass/v1/public/result`
- `OPTIONS /api/chass/v1/public/*`

POST / PUT / PATCH / DELETEは405。保存済みD1 Snapshotのみをwhitelist serializeし、NAR/JRA取得、予想再計算、D1 writeを行わない。既存Bearer AI Data BridgeとMCPは維持した。

## Research Storage

- D1: Operational Source of Truth。
- Google Drive: JRA/NAR別の日次Archive。Feature Flagは既定OFF。
- Airtable: 印・💎・⚠️・重大失敗等の重要研究Indexのみ。既定OFF。
- Cron優先順はAuto Result → Historical Collector → Research Sync。
- Drive/Airtable障害は予想・D1保存の成功を変更しない。
- Migration `0004_research_storage_sync.sql`はテーブル・Index追加のみ。

## Longshot Scenario Intelligence

本番💎やFINALを変更しないShadow研究として追加。

- 能力穴
- 先行残り穴
- 差し込み穴
- 条件変化穴
- 人気薄再スキャン
- Missing Longshot Mining

予想時Snapshotに存在しない理由や確率は生成しない。結果からPredictionを作り直さない。

## TIME / Calibration Research

JRA/NARを分離して以下を追加。

- 勝率・TOP3: Brier Score / Log Loss / ECE
- TIME: MAE / Mean Error / Median Error / Max Error / Error Direction
- 条件別TIME: track / distance / surface / going / weather / runningStyle / weight / distanceChange
- 50R未満は候補比較なし
- 50R以上は時間順70/30 Walk-Forward
- temperature / logistic / isotonicはShadow候補のみ
- 自動昇格なし、本番予想差分0

## JRA / NAR separation

- raceType / organizationを保存・集計・API・Archiveで分離。
- JRA不足時にNAR研究値をfallback混入しない。
- 既存race_idは書き換えていない。
- JRA Prediction EngineとNAR Prediction Engineは独立維持。

## 現行モデル不変確認

- JRA順位Simulation: 12,000回
- JRA TIME: race baseline 62% / horse individual 38%
- AI勝率・TOP3率・TIME・TOTALの本番式: 変更なし
- NAR parser / transport: 変更なし
- Historical Similarity重み: 変更なし
- Public APIでの異常確率補正: なし。validation flagのみ

## Feature Flags

- `ENABLE_PUBLIC_API`
- `ENABLE_DRIVE_SYNC`
- `ENABLE_AIRTABLE_INDEX`
- `ENABLE_LONGSHOT_SCENARIO`
- `ENABLE_CALIBRATION_RESEARCH`

外部同期は既定OFF。Shadow機能停止時もCore予想は継続する。

## Tests

- 改修前ベースライン: 230 / 230 PASS
- PHASE 1完了: 233 / 233 PASS
- PHASE 2完了: 238 / 238 PASS
- PHASE 3完了: 243 / 243 PASS
- PHASE 4完了: 254 / 254 PASS
- PHASE 5完了: 260 / 260 PASS
- PHASE 6完了: 266 / 266 PASS
- PHASE 7完了: **275 / 275 PASS**

最終構文検査対象: app、legacy placeholder、Worker、server、JRA modules、Longshot、Calibration、Similarity、Meeting、Research Sync、MCP。すべてPASS。

## Performance before / after

確認できた自動テスト結果:

- 同一Snapshotを10回保存: 改修後write 0 / Cloud POST 0。
- 単一レースCloud sync: 全Research refresh 0。
- Manifest: fingerprint移行済み行では巨大Snapshot bodyを読まない。

本番Cloudflare環境での実リクエスト数・CPU時間・レイテンシは未実測。

## Security

- Public APIはGET / HEAD / OPTIONSのみ。
- raw D1 recordを公開せずfield whitelistを使用。
- Token、Secret、Authorization、SQL、stack traceを返さない。
- Drive/Airtable資格情報はWorker Secret前提。
- BrowserやGitHubへ実Secretを保存しない。
- AI Data BridgeのBearer認証は変更していない。

## Migration

- `0003_race_fingerprints.sql`
- `0004_research_storage_sync.sql`

いずれも追加型でDROPなし。既存race_id、Prediction、Result、Validationを削除しない。

## 未確認事項

- Cloudflare本番deploy、実D1 migration適用、Cron実行はこのローカル環境では未実施。
- iPhone Safari実機での最終操作確認は未実施。
- Google Drive/Airtable実資格情報がないため実upload/updateは未実施。
- 実研究母集団によるJRA/NAR別Brier、ECE、TIME MAE、穴馬ROIは未算出。
- 本番環境のbefore/afterリクエスト数と完了時間は不明。

## 推奨deploy順序

1. 現行D1 backupを取得。
2. `0003_race_fingerprints.sql`を適用。
3. `0004_research_storage_sync.sql`を適用。
4. Drive/Airtable flagsをOFFのままWorkerをdeploy。
5. Public health、既存AI Bridge health、MCP healthを確認。
6. JRA 1R・NAR 1RでPrediction/Result/Snapshot固定を確認。
7. iPhone Safari 375〜430pxで表示確認。
8. 必要な場合だけDrive、次にAirtableを個別有効化。

## Rollback

- Public API、Drive、Airtable、Longshot Scenario、Calibration ResearchはFeature Flagで個別停止可能。
- Core codeはPhase単位のREPORT記載ファイルへ戻せる。
- 追加D1列・テーブルは未参照でもCoreに影響しないため、既存データ保護を優先してDROPしない。
- legacy Scratch Live dataは削除せず読取互換を維持。

## Version decision

コード内Versionは`10.0.1`を維持した。理由は、本番のJRA/NAR予想式と12,000回Simulationを変更しておらず、実環境deploy・実機確認前にstable/minor releaseへ昇格させないため。正式なminor version付与はdeploy acceptance完了後に判断する。
