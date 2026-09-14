# CHASS KEIBA LAB Ver.10.0.1 POST-JRA-J5 STABILIZATION

## 結論

Google Drive Runtimeを正式撤去し、D1を研究データのSource of Truthとして維持した。MCPの不足構成と依存関係、`.gitignore`、Repository Layout Guardを修復した。JRA J1〜J5は61/61 PASS、Full Checkは390/390 PASS、FAIL 0。

`migrations/0006_jra_background_refresh.sql` は既存ファイルを検査しただけで、一切変更していない。

## 1. 修正前Baseline

- `npm test`
- Tests: 383
- PASS: 378
- FAIL: 5
- 既存失敗: Google Drive Production旧テスト1、MCP server不足2、MCP SDK不足1、`.gitignore`不足1
- JRA J1〜J5: 61/61 PASS

## 2. Google Driveから撤去した機能

- Google OAuth refresh token処理
- Google Drive API folder検索・作成
- Drive multipart CREATE / PATCH UPDATE
- Drive archive manifestのRuntime更新
- `ENABLE_DRIVE_SYNC` Runtime判定
- Google Drive用Client ID / Client Secret / Refresh Token / Root Folder ID参照
- Drive専用retry経路
- Airtable recordへ保存していた `DriveArchiveKey`

現行ソースにはDrive接続UIとDrive専用API routeが存在しなかったため、存在しないUI/APIを新たに変更していない。CronのResearch SyncはAirtable用として残るが、Drive処理を呼ばない。

## 3. 残したResearch機能

- D1 Race / Prediction / Market / Final / Result / Validation Snapshot
- D1 Historical Collector / Similarity / Calibration
- JRA Meeting Calendar / Background Job State
- JRA/NAR organization分離
- Public Read-Only API
- AI Data Bridge
- read-only MCP
- Airtable Indexコード（既定 `ENABLE_AIRTABLE_INDEX=false`）
- 旧Queue/manifestのDrive列と既存データ（破壊・全削除なし）

旧QueueをAirtable処理する場合、Drive列は `disabled_legacy` として更新する。Airtableも無効ならD1/Network I/Oは0。

## 4. 変更ファイル

- `research-storage-sync.mjs`: Drive Runtime撤去、Airtable-only optional sync
- `README.md`: D1中心構成とDrive廃止を正式記載
- `.gitignore`: env、MCP env、node_modules、logを除外
- `tests/google-drive-production.test.mjs`: obsolete ProductionテストをDecommission Regressionへ置換
- `tests/research-storage-sync.test.mjs`: D1/Airtable-only仕様へ更新
- `tests/repository-layout.test.mjs`: migration/MCP/.gitignore構成Guard追加
- `mcp/server.mjs`: Streamable HTTP read-only MCP Server復元
- `mcp/package.json`, `mcp/package-lock.json`: MCP SDK / zod依存を固定
- `mcp/.env.example`, `mcp/README.md`: Secretを含まない設定例と運用手順

## 5. Obsolete testの扱い

`tests/google-drive-production.test.mjs` のDrive CREATE/UPDATE/OAuth復旧テストを削除し、同じファイルを以下の廃止回帰へ置換した。

- Runtime sourceにDrive依存がない
- legacy Drive env値を渡しても外部通信しない
- Scheduled handlerにDrive runnerがない
- D1 legacy列を破壊しない
- D1/Public API/JRA/NAR/Snapshotが残る

`skip`、`only`、test glob縮小は使用していない。

## 6. 0006確認

- Path: `migrations/0006_jra_background_refresh.sql`
- SHA-256: `a6287099178296d31c745cb49a25b9736d807c3665bf7364a665e0842ab6ad77`
- `CREATE TABLE IF NOT EXISTS jra_meeting_calendar`
- DROP / DELETE / UPDATE / ALTERなし
- 0001〜0006を空SQLiteへ順番に適用: 全件成功
- J5 Schema test: PASS
- 既存ファイルは変更なし
- 本番D1への適用済み状態: 未確認

## 7. MCP修復

- `mcp/server.mjs` を正式配置
- `@modelcontextprotocol/sdk` と `zod` を `mcp/package.json` / lockfileで管理
- `npm ci --prefix mcp` 可能な構成
- 6 toolsのみ: `chass_health`, `chass_get_race`, `chass_get_latest`, `chass_get_pending`, `chass_get_research`, `chass_get_recent`
- 全Toolにread-only annotations
- JRA/NAR公式への直接fetchなし
- D1保存済みSnapshotをAI Data Bridge経由で参照
- 実Streamable HTTP server起動・client call統合試験: 15/15 PASS

## 8. Test結果

| 対象 | 結果 |
|---|---:|
| JRA J1 | 18/18 PASS |
| JRA J2 | 12/12 PASS |
| JRA J3 | 11/11 PASS |
| JRA J4 | 12/12 PASS |
| JRA J5 | 8/8 PASS |
| JRA J1〜J5合計 | 61/61 PASS |
| MCP | 15/15 PASS |
| Public Read-Only API | 34/34 PASS |
| AI Data Bridge | 16/16 PASS |
| Drive decommission / Research / Layout targeted | 14/14 PASS |
| Full Check | 390/390 PASS |
| Full Check FAIL | 0 |
| skipped / only | 0 / 0 |

False Exclusion、Active Race Integrity、Snapshot Integrity、NAR parser/取得、Historical Similarity、Longshot、CalibrationもFull Check内でPASS。

## 9. 本番D1 Migration手順

本番適用済みか未確認なので、最初にlistで確認する。

```sh
npx wrangler d1 migrations list chass-keiba-research-db --remote
npx wrangler d1 migrations apply chass-keiba-research-db --remote
```

Cloudflareはbinding名よりdatabase名の使用を推奨しているため、`wrangler.jsonc` のdatabase name `chass-keiba-research-db` を使用する。適用前に対象Accountとdatabase名を再確認する。

## 10. Deploy時の注意

1. ZIP内の階層を保持してGitHubへ反映する。
2. `mcp/node_modules/` はcommitしない。
3. GitHub/Cloudflareに残るGoogle Drive Secretはコード上不要。Dashboardから削除する場合は名前と対象環境を確認して手動実施する。
4. Cron設定は削除しない。JRA J5 Meeting/Result、Auto Result、Historical Collectorが利用する。
5. D1 migration list/apply確認後にWorkerをdeployする。
6. Deploy後にPublic health、JRA meeting、MCP healthを小さく確認する。

## 11. Repository Structure

正式配置をGuard testで確認する。

```text
migrations/0006_jra_background_refresh.sql
mcp/bridge-client.mjs
mcp/chass-tools.mjs
mcp/server.mjs
mcp/package.json
mcp/package-lock.json
tests/
.gitignore
```

root直下に残る過去のflatten済みテスト複製はRuntime/active test対象ではない。GitHub上で整理する場合は、`tests/`側の同名ファイルが存在することを確認してからroot複製だけを削除する。今回の変更ZIPは削除操作を自動実行しない。

## 情報源

- Cloudflare D1 Migrations: https://developers.cloudflare.com/d1/reference/migrations/
- Official MCP TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk
- 現行CHASSソース、migration、Node test結果

## 回答日時

2026/09/10/08:30 JST
