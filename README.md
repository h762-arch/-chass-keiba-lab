# CHASS KEIBA LAB Ver.9.9.18

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
