# CHASS KEIBA LAB Ver.10.0.1 — PHASE 6 REPORT

## 結論

PHASE 6「Longshot Scenario Intelligence」をShadow Modeで実装した。既存の穴馬判定、FINAL、AI勝率、AI TOP3率、TIME、EV、JRA 12,000回Simulationは変更していない。PHASE 7は未着手。

## 変更ファイル

- `longshot-scenario.js`（新規）: Scenario Engine、人気薄再スキャン、Missing Longshot Mining
- `app.js`: Prediction Snapshot保存、Validation接続、Shadow表示
- `index.html`: VALUE PICKS内の折りたたみ表示、script読込
- `styles.css`: iPhone向けコンパクト表示
- `tests/longshot-scenario.test.mjs`: Phase 6テスト6件
- `package.json`: 新規Moduleの構文検査
- `README.md`: 仕様と停止方法

## Scenario Engine

予想時点の全出走馬を調べ、次の既存値だけを使用する。

- TOTAL / AI TOP3 / 人気 / オッズ / Market Gap
- 予想TIME順位
- 距離・コース・展開・末脚・巻き返し評価
- FrontProbability / SurvivalProbability / ClosingProbability
- 前走比斤量（存在する場合のみ）

結果、Web情報、後付け値は使用しない。入力馬Objectは変更せず、独立した`predictionSnapshot.longshotScenario`へ保存する。

## 4分類

| Supplemental Type | 表示 | 必要な確認可能根拠 |
|---|---|---|
| Ability Longshot | 能力穴 | TOTALとMarket Gap |
| Front Survival Longshot | 先行残り穴 | 脚質＋既存Front＋既存Survival |
| Closing Longshot | 差し込み穴 | 脚質＋既存Closingまたは末脚 |
| Condition Change Longshot | 条件変化穴 | 距離・コース・展開・巻き返し・斤量変化 |

複数分類を許可。根拠不足なら`scenario=null`、`confidence=low`。存在しない確率は生成せず`null`。

## Longshot Review条件

市場条件：

- 人気8位以下、または単勝15倍以上
- Deep scanは人気10位以下、または単勝30倍以上

研究候補条件：市場条件に加え、予想時点の確認可能な証拠が2件以上で、TOTAL 50以上またはAI TOP3 15%以上。これはShadow候補であり既存💎を変更しない。

## Missing Longshot Mining

結果確定後、以下を予想時点Snapshotだけで比較する。

- 7人気以下または単勝20倍以上
- 実際にTOP3
- Original Snapshotで💎なし

原因候補は、予想時に存在した証拠に対応する場合だけ付与する。

- Front / Survival underestimation
- Closing underestimation
- TIME underestimation
- Condition change missed
- Market gap missed

証拠がない場合は`dataInsufficient=true`とし、説明を創作しない。

## Feature Flag

`window.CHASS_FEATURES.ENABLE_LONGSHOT_SCENARIO=false`で停止可能。停止時も従来の予想・既存💎・Validationは動作する。

## UI

VALUE PICKSカード内に「CHASS LONGSHOT SCAN / Shadow」を追加。最大8頭を表示し、人気、オッズ、AI TOP3、4分類、信頼度、主要根拠を確認できる。初期は折りたたみで、メイン予想UIを圧迫しない。

## D1 / APIへの影響

- D1 Migration: なし。既存Prediction/Validation JSON内の後方互換フィールド追加のみ。
- Public API: 変更なし。
- AI Data Bridge / MCP: 変更なし。
- Google Drive / Airtable同期: 既存Snapshot JSONとして自然にArchive対象。同期ロジック変更なし。
- JRA/NAR: 同じShadow Schemaを使うが、研究集計は既存organization分離を維持。

## Regression確認

- 新規対象テスト: 6/6 PASS
- 対象＋既存主要テスト: 95/95 PASS
- Full Check: 266/266 PASS、fail 0
- Snapshot immutability: PASS
- 欠損確率null: PASS
- 取消馬除外: PASS
- Missing Longshotの予想時根拠限定: PASS
- 既存`evaluateLongshots()`残存・非置換: PASS

## 未確認・制限

- 実レース母集団を使った捕捉率・ROI・Walk Forward改善値はPHASE 7前の現時点では不明。自動本番昇格は行っていない。
- NARのFront/Survival/Closingが保存されていない旧データでは、その値はnullになり、他の確認可能な根拠だけで判定する。
- Shadow候補の閾値は初期研究値であり、本番係数ではない。

## Rollback

1. Feature Flagをfalseにする。
2. `index.html`のscript/Panelと`app.js`のSnapshot・render接続を戻す。
3. 追加済みSnapshot fieldは旧コードが無視できるため、既存D1データ削除は不要。
