# CHASS KEIBA LAB Ver.9.9.8

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
