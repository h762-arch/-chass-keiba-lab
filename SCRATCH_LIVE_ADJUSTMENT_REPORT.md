# CHASS KEIBA LAB Ver.9.9.29 実装報告

作成日時（日本時間）: 2026-08-31

## 【確認できた事実】

- `predictionSnapshot` と `prediction_json` は取消検知後も変更しません。
- Live Adjustedは `liveAdjustedPrediction`、取消監査は `scratchAudit` として別レイヤーに保存します。
- D1の既存 `race_json` に両レイヤーを格納するため、テーブル追加・ALTER・DROP・DELETEはありません。
- NARの既存レスポンスから `出走取消`、`競走除外`、`発走除外`、`出走取止` を判定します。新APIや取消専用ポーリングは追加していません。
- `/api/nar/race`、`/api/nar/sync`、`/api/nar/odds`、Recovery、自動結果回収の経路は維持しています。
- `npm run check`: 152件成功、失敗0件。

## 実装仕様

1. 取消検知: RaceCard、OddsTanFuku、RaceMarkTable結果の既存取得タイミングで状態を抽出します。
2. Original保護: Live生成の前後でOriginal fingerprintを照合し、変更時は例外にします。
3. Live構造: `adjustedFromModelVersion`、時刻、取消馬番、影響度、Live馬データ、Live FINAL、波乱指数、Race Confidenceを保持します。
4. AI勝率: eligible馬のOriginal確率を100%へ再正規化します。
5. AI TOP3率: 取消脚質による展開補正後、残存馬の確率総量を再配分します。
6. 展開: 唯一の逃げ馬取消はスロー化し、先行・差し構成に応じてpace fitを更新します。
7. 波乱指数: eligible馬だけの合成Snapshotで既存RVIを再実行します。Original波乱指数は保持します。
8. Race Confidence: eligible馬だけでPrediction Axis評価を再実行します。
9. 印: Live対象馬だけで◎○▲を再選定します。Original印は不変です。
10. 穴馬・期待値: 取消馬の市場値を無効化し、残存馬だけ再評価します。
11. 検証: 正式値はOriginal vs 結果。Live vs 結果を `scratchEvaluation` に別記録し、取消馬をOriginal印の分母から除外します。
12. UI: 「元予想 / 取消反映後」切替、取消頭数、影響度、波乱・◎差分、取消馬のグレー表示を追加しました。

## 変更ファイル

- `app.js`
- `worker.js`
- `server.mjs`
- `index.html`
- `styles.css`
- `package.json`
- `README.md`
- `regression.test.mjs`
- `tests/scratch-live-adjustment.test.mjs`

## 保護確認

- 既存D1データ削除なし
- D1 schema変更なし
- localStorage / IndexedDBキー変更なし
- Original AI勝率・AI TOP3率・TIME・期待値・穴馬判定・波乱指数の算出ロジック変更なし
- GitHubおよびCloudflare本番への反映は未実施

## 【推測】

- NAR公式HTMLでは開催や画面により取消文言の配置が変わる可能性があります。その場合でも、出馬表・オッズ・結果の3経路のテキスト判定で補完できる設計です。実際の本番HTML全パターンはこのローカル環境では確認していません。

