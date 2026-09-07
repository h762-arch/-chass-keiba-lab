# CHASS KEIBA LAB Ver.10.0.1 — PHASE 0 / PHASE 1 Report

## 結論

Ver.10.0.1 FULL（230/230 PASS）を基準に、PHASE 0監査とPHASE 1だけを実施した。バージョン番号、JRA 12,000回Simulation、JRA Calibration、NAR予想・通信、Similarity、AI Data Bridge、MCP、D1 schemaは変更していない。

PHASE 1では、JRA/NAR切替・raceId変更時の一時状態分離、Validation stale防止、Scratch Live再計算の本番経路廃止、発走前Result Fetch防止、Result Recovery表示の明確化、Background Collectorの0件理由診断を実装した。

## PHASE 0 — Current Source Audit

| 対象 | 現在仕様 | 今回の判断 |
|---|---|---|
| Version | `10.0.1`。UI / Worker / packageで統一 | 変更なし |
| `app.js` | UI state、NAR/JRA表示、Snapshot、IndexedDB、D1同期、結果・Validation、Collector UI | PHASE 1対象箇所だけ修正 |
| `worker.js` | NAR proxy/parser、D1 repository、Cron、Background Collector、AI Bridge | Collector診断理由だけ拡張 |
| `server.mjs` | ローカルNAR proxy、D1 unavailable時のBridge応答 | 変更なし |
| JRA modules | `jra-normalizer.js`、`jra-model.js`、`jra-adapter.js`。12,000回順位Simulationと初期Calibration | 変更なし |
| Similarity | `similarity-intelligence.mjs`。Walk Forward、JRA/NAR混在防止 | 変更なし |
| Meeting Discovery | `meeting-discovery.mjs`、`meeting_calendar`、UI selectorで共有 | 変更なし |
| MCP | `mcp/bridge-client.mjs`、`mcp/chass-tools.mjs`、`mcp/server.mjs` | 変更なし |
| D1 schema | `races`、`predictions`、`results`、`meeting_calendar`、`historical_collector_jobs` | Migrationなし |
| migrations | `0001_research_cloud.sql`、`0002_background_historical_collector.sql` | 変更なし |
| IndexedDB | `races`、`oddsHistory`、`settings` | 保存データは変更・削除なし |
| NAR取得 | `/api/nar/race` →既存parser/transport | 変更なし |
| Auto Result | 発走+10分以降、低頻度Queue / Cron | 維持 |
| Background Collector | Cron→lock→meeting discovery→collection→D1 progress | 診断表示のみ拡張 |
| AI Bridge | `/api/chass/v1/health/context/race/research/pending`、Bearer、Read-Only | 変更なし |
| Scratch参照 | `applyScratchStatuses`、Result保存ラッパー、Auto Result、表示レイヤー、legacy Bridge | 新規Live生成・表示を停止。legacy読取は維持 |
| `persist()` | Snapshot固定、IndexedDB、差分Cloud sync | 変更なし |
| Cloud sync | `/api/db/manifest`→`/api/db/sync`→research refresh | 変更なし（PHASE 3対象） |
| `/api/db/research` | D1研究データ再構成 | 変更なし |
| `/api/db/manifest` | Fingerprint descriptor | 変更なし |
| Similarity D1 read | Bridge側の保存済み研究データを対象 | 変更なし |
| Odds polling | NAR 60秒。JRAは入力値 | 変更なし |
| Result polling | UI scheduler + Cloudflare Cron | 発走前の手動/自動直呼びだけ防止 |

## PHASE 1 — 変更内容

### JRA / NAR State Isolation

- `emptyRaceState()`、`clearValidationTransient()`、`restoreSavedRace()`を追加。
- 競馬種別切替時は、表示中のrace summary、horses、market、result、validation、scratch等の一時stateを空にする。
- raceId変更時は旧レースのhorses / Snapshot / Result / Validationを表示しない。
- 保存済みレースを開く場合だけ、そのレースのResult Snapshotから実走TIMEを復元する。
- D1 / IndexedDBの保存済みデータは削除しない。

### Validation Stale State

- 新規JRA解析時にactualTimes、実馬場、結果、memo、Validation一時stateを初期化。
- 新raceIdでは過去レースの実走TIME・結果状態を引き継がない。
- Prediction Snapshotはclear対象外で、結果による書換えは行わない。

### Scratch Live Adjustment正式廃止

- 本番経路の`applyScratchStatuses()`を`status_only`へ変更。
- 新規`liveAdjustedPrediction`は生成しない。
- 取消・除外・取止は`runnerStatus` / `horseStatus` / `eligible`だけ更新。
- 他馬のAI勝率、TOP3率、印、EV、💎、⚠️、展開、波乱指数、Race Confidenceは不変。
- UIはOriginal Predictionのみ表示し、Live切替は無効化。
- Validationは取消馬をOriginal選択母数から除外。
- odds欠損だけでは取消にしない。
- D1内の既存`liveAdjustedPrediction`は削除せず、AI Bridgeもlegacyデータを引き続き読める。
- 旧計算ルーチンは本番・テスト公開経路から切り離し、新規Snapshot作成から到達不能にした。

### Historical Result Recovery / 発走前防止

- 結果未取得一覧から開いた時点で「結果を取得中…」を表示。
- 既存の成功 / 結果待ち / network・timeout・parse等の分類と診断復旧を再利用。
- `resultFetchReadiness()`を追加し、発走時刻が確定していて発走前ならResult APIを呼ばない。
- postTime不明時は従来互換のため強制禁止せず、既存経路で判定する。

### Background Historical Collector診断

- 0件理由を`no_active_job`、`locked`、`not_due`、`paused`、`no_remaining_pairs`、`deadline_guard`、`invalid_cursor`、`error`等へ分離。
- `state_json.lastBatchReason`へ保存し、D1 schema追加なしで再起動後も読める。
- Developer表示へPhase、Processed、Saved、Skipped相当（既取得）、Failed、Last Batch、Last理由を追加。
- Cron、lock TTL、Meeting-aware収集、NAR transport、batch上限は変更していない。

## 変更ファイル

- `app.js`
- `worker.js`
- `tests/scratch-live-adjustment.test.mjs`（新仕様へ置換）
- `tests/core-state-isolation.test.mjs`（追加）
- 本レポート

## D1 / Migration

- D1 schema変更: なし
- Migration追加: なし
- 既存race_id / Snapshot / Result / Validation削除: なし

## テスト

### 改修前ベースライン

- `node --test regression.test.mjs tests/*.test.mjs`
- 230 tests / 230 PASS / 0 FAIL

### PHASE 1対象テスト

- 18 tests / 18 PASS / 0 FAIL
- Original fingerprint不変
- 他馬 probability / mark / EV / 💎 / ⚠️不変
- runnerStatusのみ更新
- odds欠損を取消扱いしない
- 取消馬をValidation母数から除外
- JRA/NAR transient state分離
- 保存済みResultだけ復元
- 発走前Result Fetch判定
- Background Job / priority / lock回帰

### Full Check

- `npm run check`
- syntax check: 全対象PASS
- 233 tests / 233 PASS / 0 FAIL

## 既存機能への影響

- JRA Simulation / Calibration: 変更なし
- NAR予想 / parser / transport: 変更なし
- Result Recovery: 既存経路を維持し表示と発走前guardのみ追加
- Auto Result Queue: 変更なし
- Meeting Discovery / Selector: 変更なし
- Background Collector: 収集ロジック変更なし、診断だけ追加
- Historical Similarity: 変更なし
- AI Data Bridge / MCP: endpoint・認証・Schema変更なし。legacy Live読取互換を維持
- D1 / IndexedDB: schema変更なし、保存済みデータ削除なし

## Known Issues / 未確認

- iPhone Safari実機操作、Cloudflare本番Cron、実D1での複数端末競合は、このローカル環境では未実施。
- `postTime`が欠損する旧レコードは、後方互換性を優先し発走前guardを強制しない。
- legacy Liveデータは読取互換のため残るが、新規Live Snapshotは生成されない。
- PHASE 2以降（UI Compact、Cache、Public API、Drive/Airtable、Longshot Scenario、Calibration研究）は未着手。

## Rollback

Migrationはない。上記4コード/テストファイルをVer.10.0.1 FULLの同名ファイルへ戻せばPHASE 1だけをRollbackできる。D1データ操作は不要。
