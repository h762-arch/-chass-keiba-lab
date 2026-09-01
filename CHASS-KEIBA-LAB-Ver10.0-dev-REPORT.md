# CHASS KEIBA LAB Ver.10.0-dev 実装報告

名称: JRA Integration Phase 1  
基準版: Ver.9.9.35 Active Meeting-Aware Race Selector  
実装日: 2026-09-01

## 結果

既存NARモードを既定値のまま維持し、同一アプリへ独立したJRA Adapter / Normalizer / Prediction Engineを追加した。JRA Phase 1は外部サイトへアクセスせず、JSON・CSV・手動入力の1レースを処理する。

## 新規ファイル

- `jra-normalizer.js`: JRA共通RaceData・過去走Schema、JSON/CSV/手動入力Normalize、欠損検証
- `jra-model.js`: JRA専用CHASS指数、AI確率、TIME、市場乖離、穴馬・危険人気馬評価
- `jra-adapter.js`: Normalize済みデータと既存表示・Snapshot Coreの境界
- `tests/jra-phase1.test.mjs`: 14頭、5走、CSV、欠損、市場分離、NAR非参照テスト

## 主な変更ファイル

- `index.html`: 競馬種別切替、JRA入力UI、専用モジュール読込
- `app.js`: JRAイベント、表示、Snapshot、保存、NAR操作ガード
- `styles.css`: JRA入力・指数詳細のiPhone向けレスポンシブ表示
- `package.json` / `package-lock.json`: Ver.10.0.0-dev、JRA構文検査追加
- `worker.js` / `server.mjs`: 表示モデルバージョンを10.0-devへ更新（既存NAR経路は維持）
- `README.md`: Phase 1利用概要

## JRA内部Schema

保存対象に `raceType: "JRA"` を持たせ、NARとは分離する。レースには日付、競馬場、R、レース名、芝・ダート、距離、内外、馬場、天候、想定ペースを保持する。各馬には馬番、枠、馬名、性齢、斤量、騎手、調教師、人気、オッズ、馬体重、増減、過去走を保持する。

過去走には走破TIME、TIME秒、着差、通過順位、上がり3F、斤量、人気等を保持する。将来用ラップ領域は `first3F`, `fiveF`, `sevenF`, `nineF`, `L3F`, `L2F`, `L1F` とした。

## JRA能力評価

市場情報を使わず、以下を0〜100で相対化する。

- SPEED: 距離、芝・ダート、馬場、斤量を補正した速度
- RECENT: 直近ほど重く、今回条件への近さを加味した近走内容
- DISTANCE: 近似距離を連続的に減衰評価
- COURSE: 左右、直線、坂、小回り・大回りを分解した類似コース変換
- FINISH: 上がり3Fと位置取りを組み合わせた末脚評価
- PACE: 通過順位から推定した脚質と今回想定ペースの適合
- TOTAL: 上記だけから作る純能力指数。人気・オッズは不使用

初期TOTAL比率は SPEED 25 / RECENT 20 / DISTANCE 15 / COURSE 15 / FINISH 12 / PACE 13。Phase 1の初期値であり、実戦較正前の開発値である。

## 確率・市場評価の順序

1. CHASS各能力指数
2. CHASS TOTAL
3. AI勝率（全馬合計約100%へ正規化）
4. AI複勝率（勝率とは別の安定性評価を含む）
5. 人気・オッズとの乖離
6. 期待値
7. 勝ち穴／相手穴、💎、⚠️

オッズなしは期待値を `null` とし、0%へ変換しない。人気薄だけを理由に💎を付けない。

## Snapshot / D1

既存Snapshot・D1保存Coreを再利用し、`raceType`, `jraModelVersion`, JRA指数、確率、TIME、人気・オッズ、💎、⚠️を固定保存する。JRA予想ではNAR Auto Result Queueへ登録しない。D1 schema migrationは追加していない。

## NARへの影響

- `/api/nar/race`, `/api/nar/sync`, `/api/nar/odds` の処理構造は変更していない
- JRAモードではこれらを呼ばないガードを追加
- NARモードは既定値で、Ver.9.9.35互換UIと通信を使用
- Historical Collector、Meeting Cache、Similarity、Auto Result、Recovery、AI Data Bridge、MCPは既存回帰試験を通過

## テスト結果

実行: `npm run check`

- 構文検査: app / chass-latest / worker / server / JRA 3モジュール / Similarity / Meeting / MCP = fail 0
- 自動テスト: 227件中227件成功、fail 0
- JRA専用: 7件成功
- 14頭×過去5走: 全馬・馬番・馬名・指数を確認
- AI勝率合計: 100%付近
- 市場分離: 人気・オッズ有無で指数、AI勝率、AI複勝率が不変
- 欠損: TIMEなしは空/null、馬体重なし・オッズなしでも処理継続
- CSV: 複数過去走行を1頭へ集約
- NAR非参照: JRA専用3モジュールに `/api/nar/` なし

## 未確認・既知の制限

- 実際のJRA 1レース公式データファイルを使った較正は未実施
- iPhone Safari実機での操作・表示確認は未実施（CSSブレークポイント実装と既存静的UI回帰は通過）
- JRA結果自動取得、リアルタイムオッズ、調教、JRA-VAN、36R一括処理はPhase 1対象外
- 波乱指数やHistorical SimilarityはJRA/NAR混在を避けるため、JRA Phase 1では既存NAR研究母集団を使用しない
- 初期指数の精度・確率較正は実結果によるWalk-Forward検証前であり、実戦性能は未確認

## 次期候補

1. JRA用CSVテンプレート自動生成
2. 実際の1レース投入と入力品質監査
3. CHASS独自指数・確率の初回Walk-Forward較正
4. JRA結果ファイル読込と競馬種別別ダッシュボード集計
