# CHASS KEIBA LAB Ver.9.9.32 完了報告

名称: **Historical Similarity Intelligence**

## 実装結果

予想時点より前に結果取得まで完了したD1上のOriginal Snapshotだけを対象に、今回レースと近い過去レースをサーバー側で抽出するShadow研究機能を実装しました。類似分析は既存予想を変更せず、UI、AI Data Bridge、MCPへ補助情報として追加されます。

## 1. 類似度計算式

各特徴量の類似度を0〜1へ変換し、欠損していない項目だけで重みを再正規化します。

```text
similarityScore = Σ(featureSimilarity × configuredWeight) / Σ(availableWeight)
```

芝とダートの不一致、および距離差400m超は候補から除外します。スコア0.50以上を標準候補とし、20R未満の場合だけ0.35まで段階的に緩和します。

## 2. 使用特徴量

- 競馬場、距離、馬場種別、馬場状態、クラス、年齢条件、性別条件、頭数
- 能力上位分布、AI勝率分布、AI3着内率分布、TIME上位差
- 逃げ・先行・差し・追込構成、想定ペース
- 人気上位オッズ構造、市場乖離、穴馬密度、人気馬危険度
- 波乱指数、Race Confidence、Prediction Consensus、place stability、pace fit

年齢・性別はクラス条件成分の一部として評価し、欠損時はその要素だけ除外します。

## 3. 特徴量重み

| 特徴 | 重み |
|---|---:|
| 競馬場 | 15% |
| 距離 | 10% |
| クラス・年齢・性別条件 | 10% |
| 頭数 | 5% |
| 馬場状態 | 5% |
| 能力分布 | 10% |
| AI勝率分布 | 10% |
| AI3着内率分布 | 10% |
| TIME分布 | 5% |
| 展開構造 | 5% |
| 人気構造 | 5% |
| 市場乖離 | 5% |
| 波乱指数・Race Confidence | 5% |

合計100%。`similarity_v1`として固定し、自動重み更新は行いません。

## 4. 類似検索件数

上位20〜50R。標準閾値0.50で20R未満の場合のみ0.35まで緩和します。50Rを超えて無制限に返しません。

## 5. similarityConfidence

類似レース件数40%、平均similarityScore 40%、特徴量充足率20%で0〜100を算出します。10R未満は最大39、20R未満は最大49、50R未満は最大74へ抑えます。

## 6. 類似人気馬成績

1人気勝率、1人気TOP3率、1人気TOP3外率、2人気TOP3率を類似度加重で返します。

## 7. 類似穴馬成績

7人気以下TOP3発生率、10人気以下TOP3発生率、相手穴・AI市場乖離型のパターン率を返します。全体ベースラインとliftを併記します。

## 8. 類似展開成績

逃げ、先行、差し、追込のTOP3率を類似度加重で返します。現在の脚質構成・想定ペースも類似度へ反映します。

## 9. successPatterns

初期ルールは次の3種です。

- AI3着内率30%以上＋7人気以下
- 相手穴＋展開適性60以上
- AI勝率順位上位3頭＋7人気以下

各ルールは最低10頭のサンプルがある場合だけ表示し、TOP3率、全体率、liftを返します。

## 10. failurePatterns

初期ルールは次の3種です。

- 能力1位＋上位人気＋展開不適合
- 1人気＋Prediction Consensus 50未満
- TIME1位＋展開不適合

最低10頭のサンプルがある場合だけ凡走率を返します。

## 11. Horse Historical Support

各馬を過去類似レース内の同タイプ馬と比較し、`support`、`neutral`、`conflict`へ分類します。最大25頭の近似馬を使い、12頭分の事前分布へ縮小したTOP3率とliftを返します。10頭未満は常に`neutral`です。

## 12. historicalConflict

類似レースの1人気崩壊率が40%以上で、今回の能力上位馬が上位人気かつpace fit 55未満の場合に`true`とします。これは警告用補助情報であり、既存⚠️を直接変更しません。

## 13. Walk-Forward結果

【確認できた事実】未来予想、結果取得時刻が今回予想より後のレース、同一raceId、結果後生成の`backtest_prediction`はテストで除外されました。OriginalとLive Adjustedも別母集団で計算されます。

【未確認】本番D1へ接続していないため、実運用データのwalk-forward率は未測定です。`/api/chass/v1/research`の`similarityMetrics`でデプロイ後に取得できます。

## 14. Baseline比較

正式予想への採用は行っていません。`mode=walk_forward_shadow`、`adopted=false`です。

## 15. 7人気以下捕捉比較

Baselineの💎捕捉とHistorical Support捕捉を別々に集計する実装を追加しました。本番値は未測定です。

## 16. 10人気以下捕捉比較

BaselineとHistorical Supportを別々に集計する実装を追加しました。本番値は未測定です。

## 17. 💎TOP3比較

既存💎TOP3率をBaselineとして保持し、Similarityは補助証拠だけを返します。💎判定は変更していません。

## 18. ⚠️評価比較

既存警告精度とHistorical Conflictの凡走補助精度を別々に返します。⚠️判定は変更していません。

## 19. Brier比較

AI確率へSimilarityを混合していないため、正式Brier差は0です。候補確率を本番へ自動昇格する処理はありません。

## 20. API変更

- `/api/chass/v1/race`: `historicalSimilarity`を追加
- `/api/chass/v1/research`: `similarityMetrics`を追加
- `/api/db/similarity?raceId=...`: アプリ表示用Read-Only類似サマリーを追加
- `detail=compact|full`: compactは主要指標と上位パターン、fullは上位類似レース・debug構成要因も返却
- Bridge schema version: `1.1`

## 21. MCP変更

既存6 Toolsを維持し、`chass_get_race`へ`historicalSimilarity`を統合しました。`chass_get_research`は`similarityMetrics`を返します。新しい書込みToolやNAR取得Toolはありません。

## 22. D1変更

変更なし。新規テーブル、列、migrationはありません。既存JSONをサーバー側で読み取り計算します。

## 23. NAR通信未変更確認

`/api/nar/race`、`/api/nar/sync`、`/api/nar/odds`、Recovery、Auto Result Queueの既存回帰テストが成功しました。Similarity APIはD1のみを読み、NARへアクセスしません。

## 24. Connector未破壊確認

既存6 Tools、Bearer認証、Read-Only annotation、Streamable HTTP、Unicode、TIME null、Original/Live分離のテストが成功しました。

## 25. 全テスト結果

```text
node --check app.js                 PASS
node --check chass-latest.js        PASS
node --check worker.js              PASS
node --check server.mjs             PASS
node --check similarity-intelligence.mjs PASS
node --check mcp/*.mjs              PASS
npm run check                       197 pass / 0 fail
```

追加テストには、同競馬場/±200m/異競馬場、芝ダート除外、頭数・展開差、未来情報、結果時刻、Historical Collector backtest除外、Snapshot不変、TIME/オッズ欠損、少数/大標本、パターン最小件数、馬別Support、Original/Live分離、50R性能、Bridge、MCPを含みます。50Rの合成検索はテスト環境で約20msでした。

## 26. PATCH ZIP

`CHASS-KEIBA-LAB-Ver9.9.32-Historical-Similarity-PATCH.zip`

## 27. FULL ZIP

`CHASS-KEIBA-LAB-Ver9.9.32-Historical-Similarity-FULL.zip`

## 変更ファイル

- `similarity-intelligence.mjs`
- `worker.js`
- `app.js`
- `index.html`
- `styles.css`
- `openapi.json`
- `package.json`
- `README.md`
- `server.mjs`
- `mcp/chass-tools.mjs`
- `mcp/package.json`
- `mcp/package-lock.json`
- `mcp/README.md`
- `regression.test.mjs`
- `tests/similarity-intelligence.test.mjs`
- `tests/ai-data-bridge.test.mjs`
- `tests/mcp-connector.test.mjs`
- `tests/mcp-live-integration.test.mjs`

GitHubおよびCloudflare本番へは反映していません。
