# CPSI元資料のDrive読取接続 v1

基準main: `7645a5af038e39fca7ec06cc11bbde9e4d06ff1a`（PR #284）。

## 実装範囲

「予想入力 → CPSIを先に計算」にDrive接続キーと「Driveから取得・CPSI計算・端末保存」を追加する。日付・競馬種別・競馬場・レースを選択して1回押すと、登録済みの非公開元資料を読み取り、CPSIを先行計算し、専用IndexedDBに保存して読み戻す。毎回のJSONファイル選択を省ける。クリック操作から始まる取得であり、レース選択だけでの自動実行やcron取得は行わない。

APIは `GET /api/cpsi/sources/drive`。Workerとローカルserverに同じ読み取り専用ハンドラーを接続する。明示的な有効化がなければ503 `DRIVE_NOT_CONFIGURED`、外部I/Oなし。通常の予想・結果取得・同期から自動呼出しはしない。旧Drive予想連携・旧D1同期機能は廃止状態を維持する。

Googleへの通信はOAuthトークン交換のPOSTと、Drive/SheetsのGETだけ。サービスアカウントJWTの署名はWeb CryptoのRS256、scopeは `https://www.googleapis.com/auth/drive.readonly`。秘密鍵、GoogleアクセストークンはWorkerだけで扱う。ドメイン全体への委任やユーザーの代理実行はしない。

## 初回の本番設定（iPhoneからのWeb操作）

コード反映と本番接続設定は別である。現時点ではサービスアカウント・実元資料の配信ID・Worker Secretsは未設定/未確認。実Google取得成功とは扱わない。ChatGPTのDrive接続はWorkerに引き継がれない。

### 1. Google側

1. 使用するGoogle CloudプロジェクトでDrive APIを有効にする。native Sheets feedを使う場合はSheets APIも有効にする。
2. サービスアカウントを作成し、JSON形式の鍵を発行する。秘密鍵はCloudflareのSecretへ直接登録する。GitHub・Base64パッチ・チャット本文に貼らない。
3. 読み取り対象の正規CPSI元資料ファイルを、そのサービスアカウントのメールアドレスに「閲覧者」で共有する。公開リンクへ変更する必要はない。

サービスアカウント作成・API有効化・共有にはユーザー側の権限が必要。この作業は本パッチで自動実行しない。

### 2. Cloudflare側

対象Worker `chass-keiba-lab7` の Settings → Variables and Secrets で次の4件を **Secret** として登録し、設定を反映する。画面名はCloudflareの言語・UIで異なる場合がある。

| Secret名 | 値 |
| --- | --- |
| `CHASS_CPSI_DRIVE_SERVICE_ACCOUNT_JSON` | Googleで発行したサービスアカウントJSONの全文 |
| `CHASS_CPSI_DRIVE_SOURCES_JSON` | 下記の登録元資料設定。実在し共有済みのfileIdに置き換える |
| `CHASS_CPSI_DRIVE_READER_TOKEN` | この専用読取API用に用意した32〜256文字のランダムな接続キー。使用文字は英数字・`-`・`_`のみ。既存Bridge tokenを流用しない |
| `ENABLE_CPSI_DRIVE_READ` | 他の3件と閲覧共有が揃ってから `true` |

有効化フラグもSecretとし、wranglerの公開varsには追加しない。将来のコード反映で公開varsのfalseへ戻してしまうことを避ける。Secretが無ければコード上は常に無効。アプリ画面には `CHASS_CPSI_DRIVE_READER_TOKEN` と同じ接続キーだけを入力する。サービスアカウントJSON・Google秘密鍵は入力しない。

接続キーは画面のメモリだけで保持し、入力欄は取得開始時に消去する。localStorage・sessionStorage・IndexedDB・URLには保存しない。pagehideでも消去する。ページ再読込後は再入力が必要。Googleの鍵とは別のこのキーを、APIの `Authorization: Bearer ...` に載せる。

## 登録する元資料

対応形式は次の2種類だけ。識別情報や固定時刻を本パッチで生成しない。既存の正規PRE入力・元資料エクスポートを上流の作成処理で保存/更新し、同じDrive fileIdで配信する。

### A. Drive上のJSONファイル

前機能の「元資料ファイルを出力」から得た `CHASS_CPSI_SOURCE_BUNDLE_V1`、単体 `CHASS_CPSI_SOURCE_V1`、または `CHASS_CPSI_PRE_INPUT_V1`。元資料は1ファイル24件まで、UTF-8で2MiB以下、Drive MIME typeは `application/json` または `text/plain`。

登録設定の例。`REPLACE_WITH_REAL_...` は説明用であり、既知の有効IDではない。実際に共有したファイルのIDへ置き換える。JRA/NARの一方だけを登録してもよい。

```json
{
  "version": 1,
  "sources": [
    {"sourceId":"nar-pre","organization":"NAR","fileId":"REPLACE_WITH_REAL_NAR_FILE_ID","kind":"drive_json"},
    {"sourceId":"jra-pre","organization":"JRA","fileId":"REPLACE_WITH_REAL_JRA_FILE_ID","kind":"drive_json"}
  ]
}
```

### B. native Google Sheetsの正規配信表

範囲の先頭行を厳密に `organization` / `raceId` / `sourceJson` の3列にする。各データ行は、組織、`YYYY-MM-DD|競馬場|R`、上記単体の正規PRE入力または元資料artifactのJSON文字列。sourceJsonは1セル50,000文字以下、最大24データ行。

```json
{
  "version": 1,
  "sources": [
    {"sourceId":"nar-pre-feed","organization":"NAR","fileId":"REPLACE_WITH_REAL_SHEET_ID","kind":"sheets_feed","range":"'CPSI元資料'!A1:C25"}
  ]
}
```

配信タブは元資料の作成側で用意する。既存アーカイブにそのタブが存在するとは仮定しない。本変更は既存Sheetを編集・新設しない。元の指数マスターをコピーするだけではRun/Input Snapshot/Index Snapshot/正規馬ID/固定時刻は揃わない。対応する正規入力を上流で組み立ててから配信する。旧列を推測変換して数値を正式昇格させるフォールバックは持たない。

Googleのnative SheetsはDriveの `alt=media` ではダウンロードできないため、Sheets values APIで登録された小範囲だけを読み取る。列名が違う場合は `DRIVE_SOURCE_FEED_REQUIRED`。行のorganization/raceIdとJSON本文が違う場合も拒否する。

## 取得・保存の検証順序

1. 有効化 → 専用接続キー → 同一origin → 選択レースを検査する。登録外fileId・URL・範囲をクライアントから指定できない。
2. 読み取り専用のGoogleトークンを取得する。登録ファイルは最大8件、選択したJRA/NARだけを読む。
3. DriveのfileId・MIME・version・modifiedTimeを読む。本文を取得し、再度metadataを読んでversion/modifiedTimeの変化がないか検査する。
4. 対象レースの正規PRE入力だけを検査する。対象外の別レースについてはCPSIを再計算しない。Run/Snapshot/全馬ID/時刻/結果漏洩/市場混入/成分を既存coreで確認する。
5. 複数Run・固定単位が残れば409 `DRIVE_SOURCE_RUN_AMBIGUOUS`。既知値・Authority・取得時刻等が相違すれば409 `DRIVE_SOURCE_CONFLICT`。入力済みの同一レースがある場合は、そのRun/Input/Indexの識別子を指定して取得する。最新Runを勝手に選ばない。
6. ブラウザ側でもartifactのハッシュと正規PRE入力を再検査し、既存入力と固定単位が完全一致する不足だけを回復して新規計算する。
7. 専用IndexedDBへ保存、別transactionで物理readback、件数・馬ID・SHA-256を確認する。ここまで成功した場合だけ画面に「Drive取得・端末読戻完了」と出す。
8. 保存が終わった時点の発走前境界を再確認して表示する。選択変更・中断・発走時刻超過後の遅延応答は表示へ反映しない。

サーバー全体の取得期限15秒、ブラウザ20秒。Google応答はサイズとUTF-8/JSONを検査し、認証/権限/タイムアウト/取得中の更新/識別情報不足/端末保存失敗は別の理由を表示する。エラー本文・秘密鍵・トークン・Googleの詳細例外をクライアントへ転送しない。応答はprivate/no-store、公開CORSなし。

Google認証でファイルを取得できたことは `transportAuthenticated:true` とする。元資料自体の独立した正本認証を意味しないため `sourceOriginAuthenticated:false`、Formal KPI HOLD / Probability MODEL_HOLD / Production activation NO-GOを維持する。DriveやD1へ書き戻さない。

## 検証と残作業

Google HTTPはmockし、実際のRSA鍵ペアでJWT署名を検証する。JRA/NARの取得・native Sheets・更新競合・複数Run・ID不足・漏洩拒否・権限・タイムアウト・秘密情報非表示・実Workerの既定無効を検証する。実ブラウザの320/390/430pxで取得操作→CPSI→IndexedDB物理readbackと、接続キー非永続化を検証する。Linux Headless Shellを利用し、実iPhoneでの完了とは扱わない。

本番Google認証・閲覧共有・実fileId/配信表・実資料取得・実iPhoneでの保存は未確認。既存アーカイブの少数行の読み取り確認は、新APIの本番接続成功を証明しない。

rollbackは、まず `ENABLE_CPSI_DRIVE_READ` を削除/falseにして読取を停止する。コードrevertも可能。CPSI係数・市場/Wave式・確率・印・💎/⚠️・元EARLY/Signal・D1・56件の同期保留・cron・workflowは変更しない。

## 一次資料

- https://developers.google.com/identity/protocols/oauth2/service-account
- https://developers.google.com/workspace/drive/api/reference/rest/v3/files/get
- https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/get
- https://developers.cloudflare.com/workers/configuration/secrets/
- BOX原案: https://docs.google.com/document/d/1P2Z7WbovBH09C3TA6jhoSTiG8iw23B6JKoP45cXzURs/edit
