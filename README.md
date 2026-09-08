# CHASS KEIBA LAB Ver.10.0.1

## Public Read-Only Prediction API（Phase 4）

Cloudflare D1へ保存済みのSnapshotだけを公開参照します。Bearer認証付きAI Data BridgeとMCPは従来どおり独立して利用できます。公開APIからNAR/JRA外部取得、予想再計算、D1書込は行いません。

- `GET /api/chass/v1/public/health`
- `GET /api/chass/v1/public/latest`
- `GET /api/chass/v1/public/recent?limit=10`
- `GET /api/chass/v1/public/races?date=YYYY-MM-DD&track=大井`
- `GET /api/chass/v1/public/day?date=YYYY-MM-DD&track=大井&organization=NAR`
- `GET /api/chass/v1/public/day-ai?date=YYYY-MM-DD&track=大井&organization=NAR`
- `GET /api/chass/v1/public/race?date=YYYY-MM-DD&track=大井&race=10&organization=NAR`
- `GET /api/chass/v1/public/result?date=YYYY-MM-DD&track=大井&race=10&organization=NAR`

`race`と`latest`は`format=compact`に対応します。`day`は通信量を抑えるためcompactが既定で、`format=full`を明示した場合だけ完全Schemaを返します。`day`は指定日・指定競馬場の保存済み予想を最大12R、レース番号順で一括取得し、AIやテキスト取得環境が内容を行単位で展開できるよう改行・インデント付きJSONで返します。`organization`は`JRA`または`NAR`です。競馬場から一意に判定できる場合は省略できます。公開配下は`GET`、`HEAD`、`OPTIONS`のみ許可し、それ以外は405です。

`day-ai`はChatGPT等の1日比較向けです。通常は改行付き`application/json`を返し、保存済みSnapshotから`abilityRank`、`evRank`、`abilityPopularityGap`、レース別Top3と市場サマリーを生成します。旧来の1レース1行・1頭1行形式は`format=text`で利用できます。

市場値は保存済みMarket Snapshotだけを使用します。`0`や空値は未取得として`null`を返し、全出走馬の保存済み単勝オッズが揃う場合だけ人気順位を安定計算します。期待値はAPIレスポンス上で`winProb × odds`（1.00=100%）として統一します。Public APIから外部オッズ取得、Prediction再計算、D1書き込みは行いません。💎・⚠️は保存済みCHASS判定だけを返し、API独自の推測生成はしません。

NARの現在オッズ取得元は地方競馬全国協会の`OddsTanFuku`です。取得レスポンスにはParser診断と取得頭数を含め、Market Snapshotには`marketDataSource`、`oddsCoverage`、`oddsHorseCount`、`totalHorseCount`、`evRankStatus`を保存します。公式表が「枠・馬番・馬名・単勝」形式でも「人気・枠・馬番・馬名・単勝」形式でも、見出し名から列を特定します。

環境変数`ENABLE_PUBLIC_API=false`で公開経路だけ停止できます。初期値は有効です。公開可否を決める前に、D1へ個人情報や非公開情報を保存していないことを運用側でも確認してください。

Cloudflareへ通常どおりWorkerをデプロイ後、`/api/chass/v1/public/health`で接続を確認します。ローカル`server.mjs`にはD1 bindingがないため、公開データAPIは`DATABASE_UNAVAILABLE`を返します。

## JRA Calibration & Automatic Validation

Ver.10.0.1ではJRA Phase 1を初回較正し、勝率・2着率・3着内率を同一の12,000回順位シミュレーションから算出します。各馬で `AI勝率 <= AI TOP3率` を保証し、距離実績が不確かな馬は平均能力を一律に落とさず確率分布を広げます。

- 能力評価と期待値評価を画面上で分離
- 能力危険と市場過熱を分離
- 勝ち穴条件を厳格化し、相手穴と区別
- レース基準TIMEへ縮約し、TIMEと能力順位の大幅乖離を診断
- 予想時／実走時の天候・馬場を別保存
- 手動結果／公式結果の出所を明示
- 結果保存後に印、穴馬、危険評価、TIME MAEを自動検証

詳細は `CHASS-KEIBA-LAB-Ver10.0.1-REPORT.md` を参照してください。

Ver.9.9.35の地方競馬機能を維持し、同一アプリへJRA Integration Phase 1を追加した開発版です。

## JRA Phase 1

- 「競馬種別」で地方競馬（既定）／中央競馬を切替
- JSON、CSV、手動入力をJRA共通SchemaへNormalize
- CHASS SPEED / RECENT / DISTANCE / COURSE / FINISH / PACE / TOTALを算出
- 能力評価後にAI勝率・AI複勝率、その後にオッズ・人気、期待値、💎、⚠️を評価
- 全馬表示、指数詳細、予想TIME、Snapshot保存、手動結果検証に対応

JRA Phase 1は外部サイトへ自動アクセスしません。入力にない値は推測せず、`null`または算出不可として扱います。

## Ver.9.9.35 Active Meeting-Aware Race Selector

- 通常予想の日付選択時に、既存の `meeting_calendar` と端末cacheを確認し、開催会場だけを選択可能にします。
- 開催日は共有済み `raceNumbers` から実在レースだけを表示し、11R開催で12Rを生成しません。
- cache missだけ既存NAR Meeting Discoveryを逐次実行し、同日要求はsingle-flightで1本化します。
- 非開催と取得失敗を分離し、取得失敗時は明示付き手動選択へfallbackして予想本体を止めません。
- `/api/nar/race`・`/api/nar/sync`・`/api/nar/odds`、Auto Result、Background Collector、Similarity、AI Bridge、MCP、予想ロジックは維持しています。

## Ver.9.9.34 Cloud Background Historical Collector

- 期間・競馬場をD1の有限Jobとして登録し、Safariを閉じても既存5分Cronから少量ずつ再開します。
- `historical_collector_jobs`へphase/cursor/進捗を保存し、`locked_until`の2分ロックで重複Cronを防止します。
- 1回最大3組または3R、内部deadline 18秒、逐次実行と750ms間隔で低負荷に制御します。
- scheduled処理はAuto Resultを先に完了し、処理件数に応じてHistoricalを3件・1件・skipへ絞ります。
- Safariは開始・一時停止・再開・進捗表示だけを担当し、45秒pollingはD1 Job APIだけを読みます。
- ローカルD1なし環境ではVer.9.9.33のForeground Collectorへfallbackします。

## Ver.9.9.33 Historical Meeting-Aware Collector

- NAR公式 `RaceList` を日付×競馬場ごとに1回確認し、開催有無と実在レース番号を同時に取得します。
- 非開催日は2R〜12Rを照会せず、11R開催では12Rを生成しません。
- 開催情報は `localStorage` と既存IndexedDB `settings` へ長期キャッシュします。判定不能・通信失敗は `non_meeting` として保存しません。
- Collectorは `Meeting Discovery → Race Discovery → Collection` の段階進捗を保存し、巨大な全レースplan配列を作りません。
- 進捗リセット、開催日キャッシュリセット、保存済み研究データは互いに独立しています。
- `/api/nar/race`、`/api/nar/sync`、`/api/nar/odds`、Historical Similarity、AI Data Bridge、MCP、予想ロジックは維持しています。

## Ver.9.9.32 Historical Similarity Intelligence

- 予想時点より前に結果取得まで完了したOriginal Snapshotだけを候補にし、未来情報リークを防ぐwalk-forward類似検索を追加しました。
- 競馬場・距離・クラス・頭数・馬場・能力/確率/TIME分布・展開・市場・波乱指数を、欠損項目を除外して再配分した重みで0〜1評価します。
- 類似人気馬・穴馬・脚質成績、成功/失敗パターン、馬別Historical Support、既存予想とのConflictをShadow補助として表示します。
- `/api/chass/v1/race`と`chass_get_race`へ`historicalSimilarity`を後方互換の追加フィールドとして統合しました。
- 既存AI確率・TIME・FINAL・穴馬・波乱指数は変更せず、D1 schemaとNAR通信にも変更はありません。

## Ver.9.9.31 ChatGPT Connector Bridge

- 独立した`/mcp` Streamable HTTP Serverを追加し、ChatGPT/CodexからAI Data Bridgeを参照できます。
- `chass_health`、`chass_get_race`、`chass_get_latest`、`chass_get_pending`、`chass_get_research`、`chass_get_recent`の6つだけを公開します。
- 全ToolはRead-Onlyで、NAR直接取得・D1書込み・予想再計算を行いません。
- Bridge tokenはMCP環境変数だけに保持し、tool output、URL、ログへ出しません。
- `today`はAsia/Tokyoで絶対日付化し、競馬場名は明示済みaliasだけを正規化します。
- 既定はcompact、検証時のみfullを利用します。旧Live Adjustedデータは互換読取専用で、新規予想はOriginal Snapshotを固定します。
- アプリ本体、既存AI Data Bridge schema、D1 schema、NAR通信、予想ロジックは変更していません。

## Ver.9.9.30 CHASS AI Data Bridge

- Bearer認証付きのRead-Only API（`/api/chass/v1/*`）から、保存済みD1研究データだけを返します。
- `latest`、`race`、`recent`、`pending`、`research`を用途別に取得でき、既定・最大件数を制限します。
- Original Prediction Snapshotを固定し、TIME欠損は`null`と欠損理由で表現します。旧Live Adjusted Predictionは互換読取専用です。
- SQLは固定SELECTだけを許可し、GETからD1書込み・NAR再取得・任意SQLを実行できません。
- CORSは許可Origin一致時のみ、最新系レスポンスは`Cache-Control: no-store`です。
- OpenAPIは`/api/chass/v1/openapi.json`で公開し、書込み操作や実トークンを含めません。

## Ver.9.9.29 Scratch Horse Snapshot Preservation & Live Adjustment

> 履歴注記：この節のLive Adjustmentは旧仕様です。現行Ver.10.0.1では取消・除外時もOriginal Predictionを変更せず、`runnerStatus`だけを更新します。

- 通常取得失敗後に診断復旧で着順3頭以上を取得できた場合、最終状態を成功へ正規化します。
- 結果未公開と一時通信失敗を分離し、5・5・10・15・30分の低頻度再確認を最大6回行います。
- TIME・市場の一部欠損を通信失敗にせず、取得件数と欠損理由を個別表示します。
- `/api/nar/race`、`/api/nar/sync`、`/api/nar/odds` の通常通信構造、予想Snapshot、AI・穴馬・波乱指数ロジックは変更していません。

## Ver.9.9.27 Prediction Axis Reinforcement

- `speed_ceiling`、`place_stability`、`pace_fit`、`distance_change_fit`、`transfer_level`、`condition_progress`、`prediction_consensus`、`race_confidence` を独立した補助軸として算出します。
- JRA等の転入元、距離短縮、叩き2戦目を固定ボーナスにせず、確認できる走破・条件・傾向データがある場合だけ評価します。
- 勝ち候補と相手安定候補を分け、人気薄で複勝安定性の高い馬を `place_longshot_score` で候補化します。
- 新軸は `shadow` 候補モデルです。予想時点Snapshotへ固定保存し、現行モデルとの読み取り専用walk-forward比較をダッシュボードに表示します。
- 実データでTOP3捕捉・相手穴捕捉・確率較正の改善を確認するまで、現行AI勝率・AI3着内率・FINAL・穴馬印を自動置換しません。
- Ver.9.9.26の波乱指数式、NAR通信、自動結果取得、Historical Collector、D1 schemaは変更していません。

## Ver.9.9.25 Automatic Post-Race Result Queue

Ver.9.9.22の安定した `/api/nar/race`・`/api/nar/sync`・`/api/nar/odds` を維持したまま、予想保存済みレースを発走時刻+10分から低頻度で自動回収します。ブラウザ起動中は60秒ごとにdueキューだけを確認し、Cloudflare Cronは5分ごと・最大5Rを逐次処理します。

## Ver.9.9.22 Stable Transport Rebase

- NAR結果取得の通常経路を `/api/nar/sync` に統一しました。
- Ver.9.9.8型の単純な fetch → parse → JSON 応答を通常経路へ戻しました。
- `sync-minimal` と診断APIは通常失敗時の非常用に限定しました。
- 結果取得の連打防止は単純な処理中ロックへ整理しました。
- D1、検証ダッシュボード、Snapshot、予想・穴馬ロジックは維持しています。

## Ver.9.9.21 Result Fetch Single-Flight / Safari Abort Isolation

- 同一raceIdの結果取得を1本のPromiseへ統合します。
- manualはautoより優先し、auto実行中の手動要求は既存flightをmanualへ昇格します。
- 無条件abortを廃止し、別レースの完了結果はstaleとしてUIへ反映しません。
- requestIdを通常・復旧経路へ引き継ぎ、Safariエラー名・メッセージ・visibility・online状態を監査します。
- 予想取得後のauto確認は800ms遅延し、同一レースのautoには45秒cooldownを設けます。

## Ver.9.9.20 NAR Result Minimal Fetch / Safari Transport Isolation

- iPhoneの結果取得を軽量な`/api/nar/sync-minimal`へ切り替えました。
- 通常レスポンスからオッズ・retry全文・重複診断を除外しました。
- Safari側でRequest・Headers・Body・JSON・Payloadを個別監査します。
- HTTP 200後の本文失敗やJSON破損をnetwork_errorへ丸めません。
- Worker処理時間・NAR取得時間・解析時間・payloadBytesを返します。

## Ver.9.9.19 NAR Race Fetch Resilience

- DebaTableSmall・RaceMarkTable・OddsTanFukuを独立取得します。
- DebaTableSmallは2回まで再試行し、RaceMarkTableはIPAT公式経路へ復旧します。
- オッズはOptionalで、失敗しても馬一覧が2頭以上なら予想を生成します。
- `/api/nar/race-diagnostic`と予想取得診断を追加しました。
- 予想保存後の結果確認は非同期化し、結果確認失敗で予想成功表示を消しません。

## Ver.9.9.18 Result Fetch Responsibility Separation

- RaceMarkTable解析成功を結果取得成功として即時固定します。
- 通常経路・診断復旧経路・保存/検証/描画の監査を分離しました。
- 最終オッズはOptionalとし、失敗しても結果本体を成功扱いにします。
- 端末側の重複リトライを廃止し、Worker通常2回＋公式予備経路1回へ整理しました。
## Ver.9.9.17 Parse-Complete Success Lock

- RaceMarkTable が HTTP 200 かつ着順解析成功した時点で「結果取得成功」を確定します。
- 最終オッズ・メタ情報・結果補完の失敗は optionalErrors として分離し、結果取得全体を 5xx に戻しません。
- 診断表示は `parse_complete` を示し、付随データだけ失敗した場合は partial success として表示します。
- 保存/D1/再集計/描画は従来どおり後段処理として分離します。


## Result Fetch Diagnostic / 原因可視化

- 再取得失敗時に `取得診断` を自動表示し、HTTP、エラーコード、通常/IPAT経路、Worker試行、端末試行、各経路の成否を確認できます。
- `/api/nar/result-diagnostic` を追加し、通常の `/api/nar/sync` が失敗した場合でも原因調査を独立実行します。
- 保存済み結果がある場合は `結果：取得済 ...｜再取得：失敗（保存済み結果には影響なし）` と明示します。
- 予想ロジック、AI勝率/TOP3率、TIME、期待値、穴馬判定、D1研究データ構造は変更していません。

## NAR Result Fetch Resilience II

- NAR公式結果取得は通常の RaceMarkTable を優先します。
- 通常経路が通信失敗、タイムアウト、HTTP 5xx/429、または結果HTMLを正常解析できない場合は RaceMarkTable_ipat を予備経路として試します。
- 多重リトライを避け、Worker通常経路2回＋公式予備経路1回に集約しています。
- オッズ取得失敗は結果取得全体を失敗扱いにしません。
- 保存済み結果がある場合、再取得だけ失敗しても既存結果・検証データを保持します。
- 予想ロジック、AI勝率/TOP3率、TIME、期待値、穴馬判定、D1研究データ構造は変更していません。

- D1上部サマリーを「予想保存 / 結果取得済 / 検証可能 / 結果未取得 / データ不備除外」の独立カード表示に整理。
- 「検証済み」を「検証母集団」へ変更し、D1母集団と分析対象の意味を明確化。
- 375〜390px幅でも改行で意味が崩れないようD1サマリーをレスポンシブ化。
- Ver.9.9.11の研究データ収集、D1同期、予想ロジック、穴馬判定、TIME、NAR取得処理は変更なし。

# CHASS KEIBA LAB Ver.9.9.12

## 今回の追加
- D1検証用語を「データ不備除外」と「品質フィルター除外」に分離。
- 過去NARレースの研究データ収集UIを追加。
- 収集データは `historical_research / backtest_prediction` として通常予想と区別。
- 既存race_idを上書きせず、途中停止・再開、D1バッチ同期、進捗保存に対応。
- 予想ロジック・AI勝率・TOP3率・TIME・期待値・穴馬判定は変更なし。

# CHASS KEIBA LAB Ver.9.9.10

## Ver.9.9.10 NAR Result Fetch Resilience

- NAR公式結果ページは15秒タイムアウト、最大3回の条件付きリトライで取得します。
- 結果未公開は通信障害と分離し、結果待ちとして扱います。
- 再取得失敗時も保存済み結果・予想Snapshot・D1結果を消去しません。

## Ver.9.9.8 D1 Validation Audit Completion

- `RESULT_MISSING` を検証除外から分離し、予想保存＝結果取得済＋結果未取得、結果取得済＝検証可能＋検証除外を監査します。
- D1結果未取得一覧から個別にNAR結果取得を開始できます。
- D1からの復元は予想Snapshot一致時だけ不足情報を追加し、差異は自動上書きせず競合として保護します。
- D1/Local Cacheの参照元、同期方向、旧形式/現行形式フィルター、モデル別穴馬捕捉指標を追加しました。

- D1の`races`・`predictions`・`results`を読み取り結合し、結果テーブルだけに残る公式結果を安全に復元
- オンライン時の検証母集団をCloudflare D1、IndexedDBをキャッシュ・オフライン退避として明確化
- 「クラウドへ同期」と「クラウドから復元」を分離
- D1予想保存・結果取得済・検証可能・結果未取得・検証除外を表示
- race_idごとの除外理由を表示し、予想Snapshotは上書き・再計算しない

## Ver.9.9.6 D1 Differential Sync Optimization

- `/api/db/manifest` の軽量指紋Manifestで同期前に差分を判定
- Worker側でも同一Snapshot・結果・検証の再書き込みを防止
- 手動同期は新規・更新・変更なしを区別し、変更のないレース本体を送信しない
- 同期やD1読込だけでは `updatedAt` を更新しない
- 固定済みpredictionSnapshotは結果取得・再同期時に上書きしない

## Ver.9.9.5 D1 Binding Fix

- Cloudflareダッシュボードで接続済みの正式Binding `DB` を `env.DB` で参照
- 旧Binding名 `chass-keiba-lab-db` への依存を削除
- health確認を `d1_binding_unavailable` / `d1_query_failed` / `d1_schema_error` に分類

## Ver.9.9.4 Cloud Research Sync

- Cloudflare D1 binding `env.DB` を利用
- D1をクラウド研究データ保存先、IndexedDBをローカルキャッシュ兼オフライン退避先として併用
- `/api/db/health`、`/api/db/races`、`/api/db/sync` を追加（DELETE APIなし）
- `predictionSnapshot` はD1でも挿入後に更新せず、結果・検証データだけを追記更新
- D1失敗時はローカル保存を成功させ、同期待ちとして次回再送
- `d1-schema.sql` とWorkerの安全な初期化処理に `races`、`predictions`、`results` を定義

## Ver.9.9.3 Longshot Discovery

- AI勝率・AI TOP3率・TIME・CHASS FINALとは独立した `longshotScore` を追加
- 市場乖離、TIME順位、距離・コース適性、展開、近走内容、巻き返し余地を利用可能データだけで再正規化
- 勝ち穴（最大2頭）、相手穴（最大3頭）、大穴（最大1頭）を分離し、根拠なしの人気薄は表示しない
- 穴馬判定と根拠を予想・市場Snapshotへ固定し、結果取得後に自動変更しない
- 保存済みSnapshotを変更しない旧9.9.2対新9.9.3シミュレーションを検証画面へ追加
- 7人気以下のTOP3取りこぼしをTIME・条件適性・TOP3率・展開・市場乖離に分類

地方競馬の予想、予想時点Snapshot固定、NAR公式結果取得、レース後検証を行う研究アプリです。

## 現在の保存構造

- IndexedDBを主保存先として使用
- IndexedDBが利用できない場合はlocalStorageへフォールバック
- 既存localStorageデータは削除せず移行
- predictionSnapshot / marketSnapshot / finalSnapshot / resultSnapshot / validationSnapshotを分離
- 結果取得後も予想時点Snapshotを自動上書きしない

## TIME

- 標準TIME
- 展開ハマりTIME
- 展開不利TIME
- 実績TIMEと距離補正TIMEを区別
- ダッシュボードでMAE、Mean Error、方向別誤差、シナリオ最接近率を検証

## 検証ダッシュボード

- 実績ベースの失敗、検証候補、データ不足を分離
- AI勝率・AI TOP3率を確率帯別に較正
- AI TOP3率と出走頭数別の正式複勝対象を別集計
- Wilson法による95%信頼区間を較正・モデル比較に表示
- 分析品質フィルタで低品質レースを統計から明示的に除外可能
- モデルVer別にFINAL勝率・TOP3率・TIME MAEを比較
- 全研究データを1つのJSONへExport可能
- Importは既存データを削除せず、raceIdと更新日時で安全に統合
- `predictionCreatedAt` / `resultAcquiredAt` / `modelVersion`を明示し、ウォークフォワード比較の基盤を固定
- ダッシュボードをモデルVer.で絞り込み、異なるモデル世代を混ぜずに比較可能
- モデル別に確定単勝オッズ取得済みレースだけを使った仮想単勝ROIを表示
- ROIの対象数・的中数を併記し、オッズ欠損を0円回収として扱わない
- 保存レース詳細にCHASS FINAL 1位馬の確定単勝オッズを表示
- prediction / market / FINAL Snapshotへ正規化JSON指紋を付与し、結果取得後の変更を検知
- 予想生成日時より結果取得日時が前になる不正な時系列を検知
- 研究データ監査で固定確認済・旧データ未検証・要確認を分離
- Snapshot改変または時系列異常を品質Cとして分析から除外可能
- 勝ち穴・相手穴・大穴ごとに、確定単勝オッズ取得済み対象の仮想単勝ROIを表示
- 位置取りは事前脚質と初角順位が大きく違う場合だけ「検証候補」とし、失敗原因とは断定しない
- 新しいschemaのバックアップは旧アプリで拒否し、誤った復元を防止
- 率には成功数/対象数と母数信頼度を表示
- 中央/地方、競馬場、期間、データ品質で絞り込み
- 保存レースから当時の予想画面へ戻ることが可能

## Development checks

Node.js 20以上で、外部テストライブラリやライブNAR通信なしに回帰テストを実行できます。

```sh
npm test
npm run check
```

`regression.test.mjs`が`nar-fixtures.mjs`の固定fixtureを読み込み、Snapshot固定、TOP3・正式複勝判定、95%信頼区間、診断分類、較正、TIME、NAR Parser、旧データ移行を検証します。

## Phase 5: Research Archive / Index（既定OFF）

D1をOperational Source of Truthのまま維持し、D1保存成功後に研究同期キューをbest-effort登録します。5分Cronは `Auto Result → Historical Collector → Research Sync` の順で、Research Syncは1回最大1件・8秒deadlineです。Drive/Airtable障害は予想・結果・D1保存の成功判定へ影響しません。

- Google Drive: `JRA/Daily/YYYY/MM/YYYY-MM-DD-research.json` と `NAR/Daily/...` を物理分離し、日次ファイルをfileId＋contentHashで更新します。
- Airtable: 完全D1コピーではなく、印・💎・⚠️・重大検証失敗・大きなMarket Gapを含む重要レースだけを1 Race = 1 Recordで索引化します。
- Prediction / Result / Validation Snapshotは別フィールドに保持し、PredictionSourceは現在 `CHASS_APP` のみです。
- 同期は `ENABLE_DRIVE_SYNC=true` / `ENABLE_AIRTABLE_INDEX=true` の個別Feature Flagで有効化します。初期値は両方OFFです。

ローカルのキー名は `.dev.vars.example` を参照し、実値は `wrangler secret put` で登録してください。Secretを`.dev.vars`以外のソース、ブラウザ、GitHub、APIレスポンスへ置かないでください。先に `migrations/0004_research_storage_sync.sql` をD1へ適用します。

## Phase 6: Longshot Scenario Intelligence（Shadow Mode）

既存の💎・FINAL・AI勝率・AI TOP3率・EVを変更せず、予想時点Snapshotに`longshotScenario`を追加します。人気8位以下／単勝15倍以上、10位以下／30倍以上を研究用に再確認し、保存済みの根拠が2件以上ある場合だけ候補化します。

- 補助分類：能力穴、先行残り穴、差し込み穴、条件変化穴（複数可）
- Front / Survival / Closingは既存値がある場合だけ使用し、欠損は`null`
- 結果確定後は予想時Snapshotと照合し、7人気以下または20倍以上のTOP3で既存💎がない馬を`Missing Longshot`として記録
- 原因は予想時に存在した証拠からのみ付与し、結果から新しい理由を後付けしない
- `window.CHASS_FEATURES.ENABLE_LONGSHOT_SCENARIO=false`でShadow表示・生成だけを停止可能

画面ではVALUE PICKS内の「CHASS LONGSHOT SCAN」を展開すると確認できます。これは研究表示であり、本番の印や買い目を自動変更しません。

## Phase 7: TIME / Probability Calibration Research（Shadow Mode）

固定Prediction Snapshotと後続Resultを使い、JRA/NARを混ぜずに確率とTIMEを研究します。本番のJRA 12,000回順位Simulation、AI確率、TOTAL、TIMEのrace baseline 62% / individual 38%は変更しません。

- AI勝率・AI TOP3率：Brier Score、Log Loss、ECE、確率帯別実績
- TIME：MAE、Mean Error、Median Error、Max Absolute Error、誤差方向
- TIME条件別：競馬場、距離、surface、馬場、天候、脚質、斤量帯、距離変化
- PredictionよりResult時刻が早いレコードは研究母集団から除外
- 欠損確率・欠損TIMEは0へ補完せず除外
- 50R未満は較正候補を比較しない
- 50R以上は時間順70%/30%のWalk-Forwardでtemperature、logistic、isotonicをShadow比較
- 候補は自動採用せず、`adopted=false`、`officialPredictionDelta=0`
- `window.CHASS_FEATURES.ENABLE_CALIBRATION_RESEARCH=false`で研究表示だけを停止可能

検証ダッシュボードの「JRA / NAR 較正研究」から確認できます。

## Compatibility

`chass-latest.js`は旧配置との互換性を維持するためのlegacy compatibility placeholderです。現在の本体処理は`app.js`に統合されています。

## Ver.9.9.10 D1 Dashboard Consistency

- 過去レースや結果を端末側へ追加した直後でも、オンライン時の検証ダッシュボードは Cloudflare D1 の最新研究データを正式母集団として再取得します。
- D1 書き込み成功後に研究データ集計をデバウンス再取得し、上部 D1 件数と下部「検証済み」が別タイミングのキャッシュを表示し続ける問題を修正しました。
- 一括クラウド同期の完了後は `/api/db/research` を再取得してからダッシュボードを更新します。
- オンライン時の `getAllRaces()` は D1 が返した `eligible` race_id のみを正式な検証母集団として使用します。端末にだけ存在する未同期レースは、D1 反映前に正式な検証件数へ混在しません。
- D1 再取得中は `D1再集計中` と表示します。
- 「再集計」および検証ダッシュボードを開いた際にも D1 の最新状態を再確認します。
- 予想ロジック、AI勝率・複勝率、TIME、期待値、穴馬判定、NAR取得ロジックは変更していません。
