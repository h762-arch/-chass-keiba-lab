# CHASS KEIBA LAB Ver.10.0.1 — PHASE 7 REPORT

## 結論

PHASE 7「TIME / Probability Calibration Research」をShadow Modeとして実装した。JRAの12,000回順位Simulation、TIMEのレース基準62%＋個体38%、NAR予想、保存済みPrediction Snapshotは変更していない。補正候補は研究表示のみで、自動昇格・本番反映は行わない。

## 変更ファイル

- 新規: `calibration-research.js`
- 新規: `tests/calibration-research.test.mjs`
- 更新: `app.js`
- 更新: `index.html`
- 更新: `styles.css`
- 更新: `package.json`

## 実装内容

### JRA / NAR独立集計

以下を `organization` ごとに完全分離した。

- AI勝率: Brier Score / Log Loss / ECE / 確率帯別実績
- AI TOP3率: Brier Score / Log Loss / ECE / 確率帯別実績
- TIME: MAE / Mean Error / Median Error / Max Absolute Error / 誤差方向
- TIME条件別: 競馬場 / 距離 / 芝ダート / 馬場 / 天候 / 脚質 / 斤量帯 / 距離変化

JRA不足時にNARを混ぜるfallbackはない。

### 時間順・欠損管理

- `predictionCreatedAt <= resultAcquiredAt` を満たすレースだけを研究母集団へ採用。
- ResultがPredictionより早いレコードは明示的に除外数へ計上。
- `null`、空文字、未取得TIME・確率は0へ補完せず、対象指標から除外。
- 保存済みPrediction SnapshotとResult Snapshotを読み取るだけで、過去Snapshotを変更しない。

### Walk-Forward Shadow較正

- 最低50R未満: `insufficient_sample`。候補比較を実行しない。
- 50〜99R: 時間順70%を学習、将来側30%を評価する研究用低サンプル。
- 100R以上: 同じWalk-Forward比較を研究用として実施。
- 候補: temperature scaling / logistic calibration / isotonic calibration。
- 比較指標: Brier Score / Log Loss / ECE。
- `adopted=false`、`officialPredictionDelta=0`、`officialModelChanged=false` を固定。

### UI

検証ダッシュボードへ「JRA / NAR 較正研究（Shadow）」を追加した。各組織について主要確率指標、TIME指標、サンプル状態、将来側評価の候補名をコンパクト表示する。375〜430pxでは1列表示となる。

### Feature Flag

`ENABLE_CALIBRATION_RESEARCH` を追加。`window.CHASS_FEATURES.ENABLE_CALIBRATION_RESEARCH = false` で研究表示を停止でき、既存コア動作には影響しない。

## D1 / API / 既存機能への影響

- D1 migration: なし
- D1 write追加: なし
- Public API変更: なし
- AI Data Bridge変更: なし
- MCP変更: なし
- Historical Similarity変更: なし
- Background Collector変更: なし
- JRA Prediction Engine変更: なし
- NAR Prediction Engine / transport変更: なし
- Scratch status-only仕様変更: なし

## テスト

PHASE 7対象テスト: 9/9 PASS。

確認項目:

1. JRA/NAR独立集計
2. 時間順不整合の除外
3. Brier / Log Loss / ECE
4. TIME MAE / ME / Median / Max
5. TIME条件別分解
6. 50R未満の候補評価禁止
7. 50R以上の時間順Walk-Forward
8. 欠損値を0補完しない
9. Shadow固定・本番変更なし

Full Check: **275 / 275 PASS、fail 0**。

改修前Phase 6完了時は266/266、今回9テスト追加後は275/275。

## 現行モデル不変確認

- JRA順位Simulation: 12,000回のまま
- JRA TIME縮約: race baseline 62% / horse individual 38%のまま
- 本番AI勝率・TOP3率・TOTAL・TIME係数: 未変更
- 自動較正・自動本番昇格: なし

## Known Issues / 未実測事項

- 実ユーザーD1の実レース母集団はこのローカル環境へ接続していないため、JRA/NAR別の実測Brier・Log Loss・ECE・TIME MAE値は未算出。画面は接続先の保存済みSnapshotから算出する。
- 単一の時間順70/30 holdoutであり、rolling windowの複数fold比較は将来候補。
- Isotonicはサンプルに敏感なため、最低件数を満たしても自動採用しない。

## Rollback

`index.html` の `calibration-research.js` 読込、`app.js` の研究カード呼出し、関連CSS、package check項目を戻し、新規モジュールとテストを除去すればPhase 7だけを独立Rollbackできる。D1変更はない。

## 次期候補

- 100R以上で複数期間foldを使うrolling Walk-Forward
- 実レース母集団の信頼区間表示
- Shadow候補のバージョン固定と比較履歴Archive
- 人間承認フロー（本番適用は別Phase）
