# CHASS KEIBA LAB Ver.10.0.1 — PHASE 2 REPORT

## 結論

Ver.10.0.1 PHASE 0/1（233/233 PASS）を基準に、PHASE 2「UI Compact & Visibility」だけを実施した。予想計算、Snapshot、D1、NAR/JRA通信、Historical Similarity、AI Data Bridge、MCPは変更していない。

## Phase

- 実施: PHASE 2 — UI Compact & Visibility
- 未着手: PHASE 3以降
- Version: 10.0.1（変更なし）

## 変更ファイル

- `app.js`
- `styles.css`
- `tests/ui-compact-visibility.test.mjs`（新規）
- `CHASS-KEIBA-LAB-Ver10.0.1-PHASE2-REPORT.md`（新規）

## 変更関数

- `render()`
- `renderFinal()`
- `renderValuePicks()`
- `renderQuick()`
- `renderHorses()`
- `renderDashboard()`
- `getMarketDisplayState()`

追加した表示専用helper:

- `marketSourceLabel()`
- `horseMarketText()`
- `horseRankGapText()`
- `horseShortComment()`

## Race Summary Compact

- 日付・surface/距離・展開・馬場を1行へ統合。
- 能力・TIME・市場取得数を1行へ統合。
- 波乱表示を `波乱指数 n%｜判定` に統一。
- `予測信頼度` と `波乱判定信頼度` を明確に分離。
- padding、gap、chip高さを縮小。

予想値や波乱指数の計算は変更していない。

## Current Odds Visibility

以下へ人気・単勝オッズを追加した。

- CHASS FINAL
- QUICK VIEW
- VALUE PICKS
- Horse Detail

表示種別:

- JRA入力データ: `入力`
- NAR実オッズ: `現在`
- 確定Snapshot: `最終`
- 予想/参考オッズ: `予想`
- 欠損: `市場未取得` / `人気未取得` / `単勝未取得`

可能な場合のみ `AI順位｜市場順位｜差` を表示する。欠損値は推測しない。

## Horse Card / Detail

- 通常カードは馬番、印、馬名、脚質、市場、勝率、TOP3、TIME、TOTALを優先。
- 既存のSPEED / RECENT / DISTANCE / COURSE / FINISH / PACEは折りたたみ内に維持。
- JRA表示は日本語ラベルを主、英語を補助表示として維持。
- Short Commentは保存済み確率、TOTAL、既存穴馬理由、既存警告理由だけから最大3文生成。
- 根拠不足時は `データ不足のため短評を生成できません。` と表示し、空白にしない。

## Validation KPI Compact

上段4KPI:

1. 検証レース数
2. TOP3捕捉率
3. 穴馬捕捉率
4. TIME MAE

詳細折りたたみ:

- 7人気以下TOP3捕捉
- 10人気以下TOP3捕捉
- 20倍以上TOP3捕捉
- 💎複勝率
- 💎単勝ROI
- ⚠️圏外率

ダッシュボードの競馬区分は `中央（JRA）` または `地方（NAR）` の明示選択とし、初期値は地方。混合集計の選択肢を除去した。

## Migration

- D1 migration: なし
- IndexedDB変更: なし
- 保存Schema変更: なし

## 既存機能への影響

- JRA 12,000回Simulation: 未変更
- JRA Calibration / Validation: 計算未変更、表示のみ整理
- NAR予想・transport: 未変更
- Result Recovery / Auto Result: 未変更
- Scratch新仕様: 未変更
- Historical Collector / Similarity: 未変更
- AI Data Bridge / MCP: 未変更
- Prediction / Market / Final / Result Snapshot: 未変更

## テスト

対象テスト:

- 市場種別（入力・現在・最終・未取得）
- AI順位 / 市場順位 / Market Gap表示
- Short Commentの既存値限定生成
- Short Comment欠損表示
- JRA/NAR検証区分分離
- 波乱判定信頼度ラベル
- 詳細KPI（20倍、💎ROI）
- 375 / 390 / 393 / 430pxで馬名可変領域が120px以上残ること

結果:

- Phase 2対象テスト: 5/5 PASS
- `npm run check`: 238/238 PASS
- fail: 0
- syntax check: 全対象PASS

## iPhone Safari

CSS自動検査では375 / 390 / 393 / 430pxの各幅で、QUICK VIEWの固定列を差し引いた馬名領域が120px以上残り、`minmax(0,1fr)`、折返し、`min-width:0`が有効であることを確認した。

実機Safariのタップ、フォント描画、Dynamic Type、セーフエリアの目視確認はこの実行環境では未確認。実機受入テストとして残す。

## Known Issues

- Race Summaryの縦幅30%削減はCSS構造上の削減を実施したが、実機ピクセル計測は未実施。
- 市場順位差は保存済み`abilityRank`と`popularity`が両方存在する場合のみ表示する。
- 💎ROIは正式な最終単勝オッズが存在する対象だけを母数にする。

## Rollback

PHASE 2の変更は `app.js`、`styles.css`、新規テストだけに限定される。PHASE 0/1 FULLへ戻し、PHASE 2追加ファイルを除外すればRollbackできる。D1/IndexedDB rollbackは不要。

## 次の候補

ユーザー承認後にPHASE 3「Race Snapshot Cache / D1 Optimization」へ進む。PHASE 3はこの実行では未着手。
