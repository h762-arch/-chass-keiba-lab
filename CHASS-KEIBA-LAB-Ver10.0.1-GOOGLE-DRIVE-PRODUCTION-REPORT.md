# CHASS KEIBA LAB Ver.10.0.1

## Google Drive Research Sync Production Activation Report

作成日: 2026-09-07

## 結論

既存Phase 5を再利用し、Google Drive同期を本番設定可能な状態へ局所拡張した。D1をOperational Source of Truthとし、Driveは失敗しても予想・結果・Validation保存を止めない長期Archiveのままである。

コード・モックDrive API・全回帰テストは成功した。実Google Drive接続は、この実行環境にOAuth SecretとFeature Flagが設定されていないため未実施であり、本番接続成功とは判定していない。

## 変更ファイル

- `research-storage-sync.mjs`
- `worker.js`
- `app.js`
- `index.html`
- `styles.css`
- `README.md`
- `tests/google-drive-production.test.mjs`（新規）

Migration追加はない。既存の `migrations/0004_research_storage_sync.sql`、`research_sync_queue`、`research_archive_manifest` を再利用した。

## 認証・Feature Flag

認証方式は既存のGoogle OAuth 2.0 offline access（Refresh Token）を維持した。BrowserはGoogle APIへ接続せず、WorkerだけがTokenを取得する。

必要設定:

- `ENABLE_DRIVE_SYNC=true`
- `GOOGLE_DRIVE_CLIENT_ID`
- `GOOGLE_DRIVE_CLIENT_SECRET`
- `GOOGLE_DRIVE_REFRESH_TOKEN`
- `GOOGLE_DRIVE_ROOT_FOLDER_ID`

`ENABLE_AIRTABLE_INDEX` は今回OFFを推奨する。設定値はWorker Secretへ登録し、診断APIとUIは存在有無だけを返す。

## Root Folderと保存Path

名前検索でRootを決めず、`GOOGLE_DRIVE_ROOT_FOLDER_ID` を直接読む。Rootが存在しない、Folderでない、削除済み、または子要素追加権限がない場合は同期を停止し、別Rootを勝手に作らない。

- JRA: `JRA/Daily/YYYY/MM/YYYY-MM-DD-research.json`
- NAR: `NAR/Daily/YYYY/MM/YYYY-MM-DD-research.json`

organizationが確定できないレースをNARへ暗黙分類しない。

## Daily Archive Schema

日次ファイルは次の構造を持つ。

- `schemaVersion`
- `archiveDate`
- `organization`
- `generatedAt`
- `races[]`

各raceは識別情報、コース条件、model/app version、Original Prediction、Result、Validation、保存済みLongshot研究項目を含む。欠損Snapshotは `null`。Drive用exportはコピー・整形であり、D1のPrediction Snapshotを変更しない。

## CREATE / UPDATE / SKIP

- manifestにfileIdなし: `CREATE`
- fileIdあり・研究内容変更あり: 同じfileIdへ `UPDATE`
- races内容のcontentHashが同一: OAuth/Drive I/O前に `SKIP`

`generatedAt`や確認時刻だけの変化は研究内容Hashへ含めない。PredictionへResultとValidationを追加する試験では、Prediction JSONがbyte-identicalであることを確認した。

## Queue・Retry・Cron

既存優先順位 `Auto Result → Historical Collector → Research Sync` を維持した。Research Syncは1 Cron最大1件、既定deadline 8秒である。

一時障害は `retry_wait` とし次回以降のCronへbackoffする。権限不足、Root不存在、organization不明は設定・データ修正を要するためterminal failureへ分離する。接続確認成功時は失敗・再試行対象を安全に再queueできる。

主要エラーコード:

- `DRIVE_CONFIG_INCOMPLETE`
- `DRIVE_AUTH_FAILED`
- `DRIVE_TOKEN_REFRESH_FAILED`
- `DRIVE_FOLDER_NOT_FOUND`
- `DRIVE_PERMISSION_DENIED`
- `DRIVE_RATE_LIMITED`
- `DRIVE_NETWORK_ERROR`
- `DRIVE_UPLOAD_FAILED`
- `DRIVE_UPDATE_FAILED`
- `DRIVE_RESPONSE_INVALID`

## UI・診断

AI連携APIの折りたたみ内へGoogle Drive研究保存状態を追加した。設定状態、同期済み、待機、再試行、失敗、JRA/NAR別件数、最終成功時刻を表示する。

「Google Drive接続確認」はOAuth Token取得と指定Root Folder metadata・書込権限だけを確認し、テストファイルを作らない。内部APIはsame-origin限定で、Public Read-Only API、AI Data Bridge、MCPのSchema・取得元は変更していない。

## セキュリティ

- raw D1 record、Secret、Authorization header、Google応答全文をUI/APIへ返さない。
- 診断はconfigured booleanだけを返す。
- BrowserからGoogle APIへ直接接続しない。
- DriveからD1への逆同期を実装していない。
- Public APIは引き続きD1 Snapshotだけを読む。

## テスト結果

対象Driveテスト: 18/18 PASS（既存6件＋新規12件）。

確認内容:

- Flag OFFでDrive I/O 0
- 設定不足でもCore/D1取得開始なし
- JRA/NAR archive分離
- 同一HashでUpload 0
- CREATE/UPDATE
- Prediction不変でResult/Validation追加
- Refresh Token失敗分類
- Root権限不足分類と代替Root未作成
- Secret非露出

Full Check: **297/297 PASS、fail 0**。改修前最新Baseline 285/285（その前の統合版275/275）から新規12テストを追加した。

## 実接続結果

この環境では次の設定が全て未設定だったため、実Google DriveへのOAuth、NAR保存、JRA保存、実API retry recoveryは未実施。

- `ENABLE_DRIVE_SYNC`
- `GOOGLE_DRIVE_CLIENT_ID`
- `GOOGLE_DRIVE_CLIENT_SECRET`
- `GOOGLE_DRIVE_REFRESH_TOKEN`
- `GOOGLE_DRIVE_ROOT_FOLDER_ID`

したがって、コード完成・自動検証成功と、本番Googleアカウントへの接続確認を分けて扱う。本番設定後、READMEの手順でmigration/deployを行い、画面の接続確認、NAR 1件、JRA 1件、Prediction→Result→Validation更新の順に実確認する必要がある。

## Known Issues / Rollback

- Google OAuth Consent Screen、Drive API有効化、Refresh Token取得はGoogle Cloud側の手動作業が必要。
- Worker isolateやGoogle側の一時障害はCron retry待ちになる。
- 緊急停止は `ENABLE_DRIVE_SYNC=false`。既存D1データ、Queue、manifestは削除しない。
- Airtableコードは維持しているが、今回は本番有効化・実接続を行っていない。
