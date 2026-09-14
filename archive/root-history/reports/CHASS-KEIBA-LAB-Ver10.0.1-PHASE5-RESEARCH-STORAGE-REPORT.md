# CHASS KEIBA LAB Ver.10.0.1 — PHASE 5 REPORT

## 結論

PHASE 5「JRA/NAR Research Storage」を最小差分で実装した。D1は引き続きOperational Source of Truthであり、Google Drive/Airtableは予想処理から切り離された低優先・再試行可能な補助保存先である。両Feature Flagの初期値はOFF。PHASE 6以降は未着手。

## 変更ファイル

- `worker.js`: 保存後キュー登録、D1テーブル、Cron末尾のResearch Sync
- `research-storage-sync.mjs`: Drive OAuth/日次Archive、Airtable重要研究Index、lock/retry/idempotency
- `migrations/0004_research_storage_sync.sql`: 追加テーブル3つ＋Index（DROPなし）
- `d1-schema.sql`: 完全スキーマへ同内容を追記
- `.dev.vars.example`: Feature FlagとSecret名のみ
- `README.md`: 構成、優先順位、導入方法
- `package.json`: 新Moduleの構文検査
- `tests/research-storage-sync.test.mjs`: Phase 5対象テスト6件

## Storage Architecture

| 保存先 | 役割 | 正本 | 障害時 |
|---|---|---:|---|
| Cloudflare D1 | 完全Snapshot・検索・集計・同期キュー | Yes | Coreエラーとして既存処理に従う |
| Google Drive | JRA/NAR別の日次長期Archive | No | queueをretry、Core成功は維持 |
| Airtable | 重要研究だけの軽量Index | No | queueをretry、Core成功は維持 |

Google DriveはRoot Folder配下を `JRA/Daily/YYYY/MM/` と `NAR/Daily/YYYY/MM/` に物理分離し、`YYYY-MM-DD-research.json` を日単位で保存する。1馬1ファイルは生成しない。未使用カテゴリは必要になった時点でlazy作成する。

## Authentication

- Google Drive: Worker SecretのClient ID / Client Secret / Refresh Tokenから短命Access Tokenを取得するOAuth 2.0 offline方式。
- Airtable: Worker SecretのPersonal Access TokenをBearerとして利用。
- Browser、Public API、AI Data Bridge、MCP、ログへSecretを渡さない。
- 実値はリポジトリへ含めず、`.dev.vars.example` はplaceholderのみ。

## Feature Flags

- `ENABLE_DRIVE_SYNC`（既定OFF）
- `ENABLE_AIRTABLE_INDEX`（既定OFF）

OFF時は外部通信もD1 queue readも行わず `disabled` で終了する。片方だけ有効化可能。

## D1 Migration

追加のみ。

1. `research_sync_queue`
   - race/model単位のUNIQUE、JRA/NAR、開催日、contentHash、Drive/Airtable個別状態、attempts、nextAttempt、2分lock。
2. `research_archive_manifest`
   - `archiveKey`、Drive fileId、contentHash。内容同一ならUpload 0。
3. `research_airtable_manifest`
   - Research Key、Airtable recordId、contentHash。内容同一ならWrite 0。

既存race_id、races、predictions、results、Snapshotは変更・削除しない。

## Queue / Cron

1. `saveD1Record()`のcreated/updated成功後にqueueをbest-effort upsert。
2. queue登録失敗は既存D1保存結果を失敗へ変更しない。
3. 既存5分Cronの順序は `Auto Result → Background Historical Collector → Research Sync`。
4. Research Syncは1 run最大1件、deadline 8秒、lock TTL 2分。
5. 失敗時は指数backoffで次回Cronへ延期。Cron内連打なし。
6. contentHashが同じ場合、queue状態・attemptsを不必要に初期化しない。

## Airtable Selection

完全D1コピーは禁止。以下を含む重要レースだけを1 Race = 1 Recordで保存する。

- ◎ / ○ / ▲
- 💎 / ⚠️
- 検証failure
- `marketGapScore >= 20`

Prediction / Result / Validation JSONは別Field。`PredictionSource=CHASS_APP`のみを実データとして保存し、`CHATGPT_CHASS`は生成していない。

## JRA/NAR Separation

明示`organization`/`raceType`を優先し、JRA10場だけを安全に識別する。Archive Key、Drive folder、Airtable record、queueの全てにorganizationを保持する。JRAとNARの集計・ファイルを混在させない。

## 既存機能への影響

- 予想ロジック、JRA 12,000回Simulation、Calibration、TIME: 変更なし
- NAR transport/parser/Result Recovery: 変更なし
- Historical Similarity / Background Collector: ロジック変更なし
- Prediction Snapshot: 上書きなし
- AI Data Bridge / MCP / Public API: endpoint/schema変更なし
- Public Write API: 追加なし

## Tests

- Phase 5対象: 12/12 PASS（既存Background対象6＋新規6）
- Full Check: 260/260 PASS、fail 0
- 構文検査: app / chass-latest / worker / server / JRA modules / Similarity / Meeting / Research Sync / MCP 全てPASS

確認項目: organization分離、flags既定OFF、hash安定、重要研究選別、disabled時I/O 0、Cron優先順、DROPなしMigration、Secret非ログ出力、既存全回帰。

## 未確認・Known Issues

- 実Google Drive/Airtable資格情報は提供されていないため、実アカウントへのupload/updateは未実施。HTTP処理はmock不要の構文・静的安全性と全回帰で確認したが、Deploy後に小さな検証用レースで接続試験が必要。
- Airtable側にはREADME記載のField名と互換な列を事前作成する必要がある。
- DriveのWeekly/Monthly/Predictions等は今回作成せず、Dailyだけを実装。空Folder乱立を避け、将来Phaseでlazy拡張する。

## Rollback

1. `ENABLE_DRIVE_SYNC=false`、`ENABLE_AIRTABLE_INDEX=false`で即時停止。
2. `worker.js`のResearch Sync import/queue/Cron呼出しを戻す。
3. 追加テーブルは残置可能でCoreから参照されない。既存データ保護のためDROPは行わない。

## Official References

- Google OAuth 2.0 Web Server / offline access: https://developers.google.com/identity/protocols/oauth2/web-server
- Google Drive uploads: https://developers.google.com/workspace/drive/api/guides/manage-uploads
- Google Drive file/folder search: https://developers.google.com/workspace/drive/api/guides/search-files
- Airtable Web API filter/auth overview: https://support.airtable.com/articles/1941464361-airtable-web-api-using-filterbyformula-or-sort-parameters
