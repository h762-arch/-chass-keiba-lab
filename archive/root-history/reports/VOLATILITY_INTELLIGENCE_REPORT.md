# CHASS KEIBA LAB Ver.9.9.26 実装報告

## Race Volatility Intelligence

### 1. 最終算出式

```text
Raw Upset Score
  = 類似レース波乱率×30%
  + AI上位団子度×20%
  + 市場乖離度×15%
  + 人気馬危険度×15%
  + 穴馬密度×10%
  + TIME接近度×5%
  + 展開不確実性×5%

Stability Adjustment = Stability Score × 35%
Unshrunk Index = clamp(Raw Upset Score - Stability Adjustment, 0, 100)
Final Index = 50 + (Unshrunk Index - 50) × Reliability
```

Reliabilityは類似件数と入力データ品質から0.25〜0.90相当へ制限し、少標本時の極端値を50%方向へ縮小します。

### 2. Upset / Stability

- Upset: 類似波乱率、AI勝率の団子度、AIと人気の順位差、上位人気の警告、穴馬候補密度、10人気以下の裏付け候補、予想TIME接近、脚質構成の不確実性。
- Stability: 類似順当率、AI1位の突出、AI TOP3率集中、能力差、TIME差、AIと人気の整合、危険人気馬・穴馬候補の少なさ。
- 波乱指数はレース全体の不確実性であり、個別馬の穴馬スコアへ加点しません。

### 3. 類似レース

競馬場、距離、馬場種別、クラス、頭数、AI勝率分布、AI TOP3率分布、能力差、TIME差、市場構成、穴馬・危険人気馬数、馬場状態を0〜1で比較します。類似度0.35以上から最大50Rを採用し、20R未満なら0.20まで緩和します。集計は類似度による加重平均です。

予想日時より前の検証済みレースだけを使うwalk-forwardガードを実装し、同一raceIdと未来レースを除外します。

### 4. 実波乱ラベル

結果取得後に、1番人気圏外、2番人気以内の両方圏外、7人気以下TOP3、10人気以下TOP3、人気薄2頭TOP3、高期待値穴馬TOP3を加点し0〜100へclampします。配当がなくても人気・着順・予想時点の市場Snapshotから評価できます。

### 5. Snapshot / D1

`predictionSnapshot.volatility`へ次を固定保存します。

- volatilityIndex / label
- confidence / confidenceLabel
- similarRaceCount
- similarUpsetRate / similarStabilityRate
- upsetScore / stabilityScore / stabilityAdjustment
- dataQuality / reasons / stabilityReasons
- weights / weightPolicy / walkForward

D1 schema、binding、database_id、migrationは変更していません。既存のprediction JSON保存経路を使用します。旧Snapshotへ結果から指数を逆算して書き戻しません。

### 6. UI / 検証

- レース上部: `波乱 72%｜波乱`のように数値と文字を併記。
- 展開詳細: 信頼度、類似R、類似波乱率、順当度、上位3理由。
- ダッシュボード: 高波乱群の実波乱率、低波乱群の順当率、MAE、Brier相当、7/10人気以下TOP3、指数帯・競馬場・距離帯・頭数別集計。
- candidate weightsはcurrent weightsと分離し、自動昇格しません。

### 7. テスト結果

- `node --check app.js`: PASS
- `node --check chass-latest.js`: PASS
- `node --check worker.js`: PASS
- `node --check server.mjs`: PASS
- `npm run check`: 124/124 PASS、fail 0

追加テストは、能力突出、AI団子、市場乖離、危険人気馬、穴馬密度、類似波乱/順当履歴、10人気以下TOP3、少標本縮小、walk-forward、較正のSnapshot限定を検証します。

### 8. 実データ検証について

この作業環境から本番D1の181Rへ接続していないため、高波乱群の実波乱率・低波乱群の順当率・7/10人気以下TOP3相関の実測値は未確認です。Ver.9.9.26以降の予想時点Snapshotが蓄積されるとダッシュボードへ表示されます。実値を推測で報告しません。

### 9. 変更していないもの

- `/api/nar/race`、`/api/nar/sync`、`/api/nar/odds`
- 自動結果回収とHistorical Collectorの通信フロー
- AI勝率、AI TOP3率、能力、TIME、総合点、期待値、穴馬、危険人気馬、市場乖離ロジック
- D1 schema、既存データ、localStorage / IndexedDBキー

`worker.js`と`server.mjs`はバージョン表記のみ更新しています。
