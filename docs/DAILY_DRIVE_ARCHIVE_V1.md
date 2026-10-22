# 日次研究結果 → Drive → 予想参照 v1

## 接続範囲

既存の09:00 JST研究バッチを実行後、同日の完了済みD1ジョブから
`CHASS_DAILY_PREDICTION_REFERENCE_V1`を作り、指定フォルダに新規保存する。
既存の5分cronは保存失敗時に同じD1記録の保存だけを再試行する。
再計算・Freeze作成・EARLY更新・Signal変更はしない。
次の日以降への自動持ち越しはしない。過去日の再計算も行わない。

JSON一つに次を含める。

- 日付・Run・入力・指数・結果を持つ再検証可能な全レースartifact
- レース別manifest、ハッシュ、HOLD/NA・未取得・網羅性の制限
- 1番人気研究、6番人気以下全頭、CPSI、Wave
- 日本語の`body.predictionPrompt`。このファイルを添付/参照して使う手順
- 研究限定フラグ。元EARLYや既存予想プロンプトは自動変更しない

ダウンロードしたJSONは次で読取専用検証できる。
`node scripts/verify-daily-reference-v1.mjs <reference.json>`
ローカル検証成功は出所の独立認証や正式PRE認定を意味しない。

保存名は `CHASS_DAILY_YYYY-MM-DD_<contentHash>.json`。
Google発行IDをD1で一度だけ予約してからcreateする。同時実行・POST応答消失でも
同じIDを再使用し、同名ファイルを毎回作らない。409ではそのIDを読み直す。
既存ファイルへPATCH/DELETEせず、変更された内容はHOLD。
Driveの実バイト読戻し→ハッシュ→全レース再計算→D1証跡読戻しの後に成功とする。
既存の成功証跡は毎回ダウンロードせず、API/アプリには「確認履歴」と表示する。
クラウド側で後から削除/改変されたことを自動検知する機能ではない。

## 実装上の境界

- `ENABLE_DAILY_DRIVE_ARCHIVE_V1=true`と日次バッチ有効化が両方必要。既定OFF。
- `CHASS_DAILY_DRIVE_OUTPUT_FOLDER_ID`：書込先フォルダのID。
- `CHASS_DAILY_DRIVE_OAUTH_JSON`：サーバーのシークレット。
  `{ "client_id":"...", "client_secret":"...", "refresh_token":"..." }`
- Google OAuthで利用者本人が許可したoffline grantを更新する。
  既存のサービスアカウント鍵・読取用scopeは変更しない。
- 個人のMy Driveへ書くため、利用者のOAuthを採用。
  サービスアカウントにはストレージ割当がなく、My Driveファイルを所有できない。
  `drive.file`を推奨するが、既存フォルダもアプリに許可されている必要がある。
  フォルダ権限とgrantの準備/接続画面はこのパッチでは自動構成しない。
- 保存権限をブラウザ・app.js・Drive出力に含めない。
- `migrations/0017_daily_drive_archive_v1.sql`は独立した予約/確認表のみ。
- 最大192レース/4MiB（Google multipartの5MB以内）。超過は分割・省略して成功扱いにせずHOLD。
- Google通信は固定HTTPSホスト、redirect拒否、上限付読取、45秒上限。
- エラー本文/トークンをAPIやログへ返さない。
- 保存ジョブがHOLDでも、既存のD1分析結果は変更しない。
- 空入力HOLDも不足状況の参照資料として保存できる。分析成功を意味しない。
- アプリの元summary.driveOutputSync=falseは計算時点の状態を保持。
  独立したdriveArchiveが保存確認履歴を表す。

## 未完了の取得側

画像OCR、馬ID照合、当日全開催発見、事前実オッズの自動取得、シナリオの自動生成、
校正済み1番人気信頼確率、提供元の独立認証は依然未接続。
本パッチは画像→全自動予想の完了や正式PRE認定を意味しない。
Google OAuth設定・本番migration・有効化・実Google読戻しは未実施。

## 導入順

1. ローカル全件確認後、BridgeでPRを作り、同head/baseのGitHub全件確認を待つ。
2. 通常のWorkers導入で0016/0017の存在を確認する。Pages成功はWorker成功ではない。
3. 利用者OAuthと出力フォルダを設定する。秘密値をチャットへ貼らない。
4. 未発走の実資料1レースで入力→D1→Drive実バイト→アプリ確認履歴を検証。
5. 対象範囲を確認してから両フラグを有効化。欠損はHOLDを保つ。

## 公式仕様

- https://developers.google.com/workspace/drive/api/guides/about-shareddrives
- https://developers.google.com/identity/protocols/oauth2/web-server
- https://developers.google.com/workspace/drive/api/reference/rest/v3/files/generateIds
- https://developers.google.com/workspace/drive/api/guides/manage-uploads
