# CHASS KEIBA LAB Ver.9.9.27 実装報告

## 結論

Prediction Axis Reinforcement は、現行予想を直ちに置換しない `shadow` 候補モデルとして実装しました。新しい補助軸・候補確率・候補印は予想時点Snapshotへ固定保存されますが、現行のAI勝率、AI3着内率、CHASS FINAL、穴馬印、危険人気馬印は変更しません。

正式採用条件は、実データのウォークフォワード比較でTOP3捕捉・相手穴捕捉・確率較正のいずれかが改善し、他指標を大きく悪化させないことです。候補重みの自動昇格は行いません。

## 新しい能力評価構造

| 指標 | 主な構成 | 安全策 |
|---|---|---|
| `speed_ceiling_score` | 予想TIME順位40%、最高指数30%、上3F能力20%、5走平均10% | 欠損項目は分母から除外 |
| `place_stability_score` | 近走安定30%、近走内容20%、距離20%、コース15%、展開10%、騎手5% | 勝率とは別計算 |
| `pace_fit_score` | 想定ペース、脚質構成、逃げ候補数 | 既存の展開判定を入力として利用 |
| `distance_change_fit` | 短縮時はスピード・追走・距離適性、延長時は安定・距離適性・持続性 | 短縮/延長の固定加点なし |
| `transfer_level_score` | 元クラス根拠、能力、距離適性、転入根拠 | 出身名だけではスコアを作らない |
| `condition_progress_score` | 明示的な状態根拠、近走トレンド、休養間隔 | 叩き2戦目の固定加点なし |
| `prediction_consensus` | 勝率・複勝率・TIME・総合・安定・展開の順位分散 | 3軸未満は不明扱い |
| `race_confidence` | 候補勝率1-2位差、上位3頭一致度、データ充足 | 波乱指数とは独立 |

## 候補AI勝率・AI3着内率

- 候補勝利スコア：総合30%、スピード上限25%、勝ち切り能力20%、展開10%、距離変更5%、状態5%、一致度5%。
- 候補複勝スコア：複勝安定30%、現行AI3着内率25%、展開15%、距離10%、コース8%、状態7%、一致度5%。
- 候補勝率はsoftmaxで合計100%、候補AI3着内率はフィールド合計300%を基準に正規化します。
- これらは `predictionAxes.candidateWinRate` / `candidatePlaceRate` へ保存します。現行 `win` / `place` は上書きしません。

## 印と相手穴

- 候補印は、◎=勝利期待、○=複勝安定、▲=展開・条件上昇、△=相手安定、☆=相手穴です。
- `place_longshot_score` は複勝安定25%、候補複勝率25%、市場乖離20%、展開10%、TIME10%、人気薄度10%です。
- 7人気以下、スコア62以上、候補複勝率18%以上を相手穴候補とします。
- 現行の勝ち穴・相手穴・大穴判定は変更していません。

## Snapshot・D1

- `predictionSnapshot.featureSchemaVersion = 2`。
- 各馬の `predictionAxes` と、レース単位の `axisModel` を予想時点に固定保存します。
- `axisModel.mode = shadow`、`adopted = false`、`autoPromotion = false` です。
- 既存JSON列に追加するためD1 schema変更・migrationはありません。
- 既存データの削除、再生成、predictionSnapshot上書きは行っていません。

## UI・検証

- レース上部へ `予想信頼 xx%` を追加しました。
- 各馬の詳細分析へ8補助軸、候補印、相手穴スコア、主要理由を追加しました。
- ダッシュボードへ「Prediction Axis比較」を追加しました。現行/候補の◎TOP3、3印捕捉、勝/複Brier、7/10人気以下捕捉を読み取り専用で比較します。
- 各軸80以上の実TOP3率を表示します。
- 失敗原因へ展開評価、距離変更、転入補正、複勝安定性の検証候補を追加しました。

## 現行モデル比較

この作業環境から本番D1研究母集団へ接続していないため、実レースの旧モデル対候補モデル、TOP3率、7人気以下捕捉率、10人気以下捕捉率は未計測です。値を推測で報告しません。配備後、保存済みSnapshotを読み取り専用で比較し、ダッシュボードへ表示します。

## 通信・既存ロジック保護

- Ver.9.9.26 FULL版との比較で、`worker.js` と `server.mjs` はバージョン文字列以外同一です。
- `fetchJsonSimple`、`performResultFetch`、`syncNar`、`loadAutoRace`、`fetchNarSyncApi`、`runAutoResultQueue` はVer.9.9.26から変更していません。
- `/api/nar/race`、`/api/nar/sync`、`/api/nar/odds`、自動結果回収、Historical Collector、D1通信は変更していません。
- Ver.9.9.26の波乱指数式、既存AI確率、TIME、能力、期待値、穴馬・危険人気馬ロジックは変更していません。

## テスト

- 全135件成功、失敗0件。
- 新規11件：能力/複勝安定分離、距離短縮、転入根拠、叩き固定加点禁止、展開適合、相手穴、初出走confidence、読み取り比較、Snapshot固定、通信/波乱式保護。
- `node --check app.js`、`node --check chass-latest.js`、`node --check worker.js`、`node --check server.mjs` 成功。
- `npm test`、`npm run check` 成功。

## 変更ファイル

- `app.js`
- `index.html`
- `styles.css`
- `worker.js`（バージョンのみ）
- `server.mjs`（バージョンのみ）
- `package.json`
- `regression.test.mjs`
- `tests/prediction-axes.test.mjs`
- `README.md`
- `更新内容.txt`
- `PREDICTION_AXIS_REINFORCEMENT_REPORT.md`

GitHubへは反映していません。
