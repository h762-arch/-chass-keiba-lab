# CHASS KEIBA LAB Ver.9.9.28 実装報告

名称: Result Recovery Normalization & Auto Retry  
確認日時: 2026/08/31 23:57 JST

## 確認できた事実

### 結果取得状態

- `/api/nar/sync` が着順3頭以上を返した場合は `success_primary` として最終成功になります。
- 通常経路が失敗しても既存の `/api/nar/result-diagnostic` が着順3頭以上を返した場合は `success_recovery` として最終成功になります。
- 復旧成功時の主表示は「結果取得成功」で、通常経路のエラーは折りたたみ診断内だけに保持します。
- 通常・復旧の両方が失敗した場合だけ `result_retry` / 「再取得待ち」になります。
- 公式ページが取得できても着順3頭未満の場合は `result_pending` / 「結果待ち」になります。
- 既存の結果がある状態で再取得に失敗しても、保存済み結果を削除・空値化しません。

### 自動結果再確認

- 初回確認は既存仕様どおり発走予定時刻の10分後です。
- 再確認間隔は 5分、5分、10分、15分、30分です。
- 最大6回で自動通信を停止し、キュー自体は結果待ちまたは再取得待ちとして保持します。
- 次回アプリ起動時に上限到達キューを再開可能な状態へ戻します。手動結果取得も引き続き利用できます。
- ブラウザ側・Cloudflare Cron側とも対象レースを逐次処理し、一斉 `Promise.all()` は使用しません。
- 手動予想、手動結果、現在オッズが動作中の場合は自動結果回収を開始しません。

### TIME・市場の欠損

- TIME欠損を次のコードへ分類しました。
  - `time_missing_no_history`
  - `time_missing_no_same_surface`
  - `time_missing_parse`
  - `time_missing_unknown`
- TIME 15/16のような一部欠損は予想取得成功を維持し、「TIME 15/16 △（実績・補正・不足）」として表示します。
- 市場15/16も予想取得成功を維持し、「市場 15/16 △」として表示します。
- 取得できた15頭分を破棄しません。
- `cloud: pending` は診断上「クラウド同期待ち」と表示し、NAR結果取得失敗には変換しません。

### 変更していない範囲

- 通常APIは引き続き `/api/nar/race`、`/api/nar/sync`、`/api/nar/odds` です。
- 通常結果取得は `/api/nar/sync` を先に使用し、復旧APIは通常失敗時だけ使用します。
- D1 schema、`wrangler.jsonc`、DB binding `DB`、database IDは変更していません。
- 既存D1データ・IndexedDBデータを削除する処理は追加していません。
- predictionSnapshotは結果取得時に再計算・上書きしません。
- AI勝率、AI3着内率、TIME算出式、期待値、穴馬判定、波乱指数、Race Confidence、Prediction Axis Reinforcementは変更していません。

## 変更ファイル

- `app.js`
- `worker.js`
- `server.mjs`
- `index.html`
- `package.json`
- `regression.test.mjs`
- `tests/result-normalization.test.mjs`（新規）
- `README.md`
- `更新内容.txt`
- `RESULT_RECOVERY_NORMALIZATION_REPORT.md`（新規）

## テスト結果

- `node --check app.js`: 成功
- `node --check chass-latest.js`: 成功
- `node --check worker.js`: 成功
- `node --check server.mjs`: 成功
- `npm test`: 143件成功 / 0件失敗
- `npm run check`: 143件成功 / 0件失敗

テストには通常成功、復旧成功、両経路失敗、結果未公開、TIME 15/16、市場15/16、Cloud同期待ち、保存済み結果保護、逐次キュー、D1差分同期、Snapshot不変、通信API維持、予想・穴馬・波乱指数の回帰確認を含みます。

## 実機・本番確認手順

1. 完全版をCloudflareへ反映し、画面のVer.が9.9.28であることを確認します。
2. 通常の予想取得でNAR取得・能力・TIME・市場の件数表示を確認します。
3. TIMEまたは市場が一部欠損するレースで、予想取得成功が維持されることを確認します。
4. 結果未公開レースで「結果待ち」と表示され、通信失敗にならないことを確認します。
5. 通常結果取得が失敗し復旧経路が成功するケースで、主表示が「結果取得成功」になることを確認します。
6. 結果待ち一覧の `nextCheckAt` 到達後に1レースずつ再確認されることを確認します。
7. 結果取得後、結果待ち一覧から対象レースが消え、検証とD1同期が完了することを確認します。
8. 保存済み結果の再取得を意図的に失敗させ、既存着順が保持されることを確認します。
9. `/api/db/health` と検証ダッシュボードのD1件数を確認します。

## 推測・未確認事項

- この環境から本番Cloudflare WorkerやiPhone Safari実機へのデプロイ・操作は行っていません。したがって、本番NAR通信と実機表示は上記手順での確認が必要です。
- 一部欠損の発生頻度や自動再確認による実運用上の回収率は、今後のレース運用データに依存します。

## 情報源

- 本リポジトリの `app.js`、`worker.js`、`server.mjs`
- 自動テスト `regression.test.mjs`、`tests/*.test.mjs`
- 設定 `wrangler.jsonc`、`d1-schema.sql`
