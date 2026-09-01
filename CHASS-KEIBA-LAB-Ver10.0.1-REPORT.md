# CHASS KEIBA LAB Ver.10.0.1 実装報告

名称：JRA Probability Consistency, Initial Calibration & Automatic Validation

## 確認できた事実

### 1. 確率整合性

- `jra-model.js` の勝率・2着率・3着内率を、同じ12,000回の順位シミュレーションから算出する方式へ変更した。
- 各試行の1着回数をAI勝率、2着回数を2着率、3着以内回数をAI TOP3率としている。
- 全馬のAI勝率合計は約100%、AI TOP3率合計は約300%となる。
- 必須テストで全馬の `P(TOP3) >= P(1着)` を確認した。
- 乱数は固定seedを使い、同一入力から同一結果を再現する。

### 2. 過集中と距離不確実性

- 距離実績不足を単純な能力減点ではなく `probabilityUncertainty` として保持する。
- 同芝・ダートで今回距離±100mの実績がなければ分散を広げる。
- 頭数が増えるほど基本分散も緩やかに拡大し、softmax型の過集中を抑える。
- 2600m未経験相当のテストでは、全馬の不確実性上昇と最大勝率50%未満を確認した。

### 3. JRA初回能力較正

- CHASS TOTALへ、対象クラスに対する過去走クラス・着差の相対証拠を12%で追加した。
- 3歳馬の成長余地を小幅な補助値として追加した。
- 今回斤量と57kg基準の差を馬単位で加味し、極端な補正を避けるため±4点へ制限した。
- 人気・オッズはTOTALおよび確率計算へ使わず、市場評価は能力計算後だけに適用する。

### 4. 予想TIME

- 各馬の条件変換TIMEを、レース全体の中央値を基準に縮約する方式へ変更した。
- 標準TIMEは「レース基準62% + 馬個別38%」で構成する。
- TIME順位と能力順位が5位以上離れた場合、`timeAbilityConflict` を保存し理由へ表示する。
- TIME欠損は空文字／nullのまま維持し、0秒へ変換しない。

### 5. 危険人気馬と穴馬

- 人気馬評価を `abilityRisk`（能力危険）と `marketHeat`（市場過熱）へ分離した。
- 市場過熱だけの馬は「市場過熱」と表示し、能力危険の⚠️と混同しない。
- 勝ち穴は、能力4位以内、AI勝率10%以上、市場推定勝率の1.5倍以上、展開適性55以上を必須とした。
- 条件を満たさない人気薄は相手穴として扱う。
- 単勝EVにはデータ信頼度由来の低・中・高を併記する。

### 6. Snapshotと結果出所

- 予想時の `weather` / `trackCondition` はOriginal Snapshotへ固定する。
- 結果側へ `predictionWeather`、`predictionTrackCondition`、`actualWeather`、`actualTrackCondition` を別保存する。
- `resultSource` は manual / official、`verificationSource` と `verificationStatus` は別項目で保持する。
- 手動結果は「🟠 手動入力｜公式照合なし」、公式自動結果は「🟢 公式自動取得」と表示する。
- 手動入力を公式結果取得済みとは表示しない。

### 7. UI

- JRAの最終判断を「能力評価」と「期待値評価」へ分離した。
- JRAでは能力上位順に◎○▲を保存・表示する。
- 入力市場は「入力単勝」「単勝オッズ」「人気順」と明示する。
- JRA手動モードでは現在オッズカードと60秒自動更新行を非表示にする。
- 詳細指数は速度、近走、距離、コース、末脚、展開を主表示とし英語名を補助表示する。
- モバイルQUICK VIEWの馬名は2行まで表示する。
- 曖昧な「信頼度」を「予測信頼度」へ変更し、理由をtitleへ保持する。

### 8. 自動答え合わせ

- 結果保存後、◎○▲の実着順、本命勝利、本命TOP3、能力印TOP3捕捉、穴馬捕捉、危険評価過剰を表示する。
- 実TIMEが入力された馬についてTIME MAE、最大誤差、最小誤差を自動計算する。
- 天候または馬場が変化した場合は「馬場・天候変化あり」と表示し、TIME誤差の別要因として保存する。
- 集計値を `validationSnapshot.jraCalibration` へ保存する。

### 9. 変更ファイル

- `jra-model.js`
- `jra-adapter.js`
- `app.js`
- `index.html`
- `styles.css`
- `worker.js`
- `server.mjs`
- `package.json`
- `package-lock.json`
- `README.md`
- `regression.test.mjs`
- `tests/jra-phase1.test.mjs`
- `tests/version.test.mjs`
- `tests/ai-data-bridge.test.mjs`
- `tests/background-historical-collector.test.mjs`

### 10. 既存機能への影響

- `/api/nar/race`、`/api/nar/sync`、`/api/nar/odds` の実装は変更していない。
- Recovery、Auto Result Queue、Background Historical Collector、Historical Similarityのロジックは変更していない。
- AI Data BridgeおよびMCP Connectorの仕様は変更していない。
- D1 schema変更はない。
- NAR予想係数・穴馬・波乱指数ロジックは変更していない。

### 11. テスト結果

- `node --check app.js`：成功
- `node --check chass-latest.js`：成功
- `node --check worker.js`：成功
- `node --check server.mjs`：成功
- JRA専用テスト：10/10成功
- `npm run check`：230/230成功

## 推測・未確認

- 新潟記念の元入力JSON/CSVがワークスペースにないため、ロデオドライブ、ゾロアストロ、ダノンシーマのVer.10.0.1再計算値は確認できない。
- この1レースに対するTIME MAE改善値も、同じ入力データで再計算していないため確認できない。
- 実機iPhone Safariでの表示・操作は、この環境では確認できない。375〜430px向けCSSと静的回帰テストは確認済み。
- 3歳成長補正、斤量補正、TIME縮約率は初期候補値であり、複数レースのウォークフォワード検証後に較正する必要がある。

## 次の検証

1. 新潟記念の同一入力ファイルをVer.10.0.1へ再投入する。
2. 3頭を含む全11頭の勝率・2着率・TOP3率とTOTALを旧版と比較する。
3. 実TIMEを入力し、旧MAE 1.81秒との比較を行う。
4. 最低50〜100RでBrier Score、TOP3較正、TIME MAE、勝ち穴・相手穴成績をウォークフォワード検証する。
5. candidate係数は検証結果を確認してから明示承認で本番昇格する。
