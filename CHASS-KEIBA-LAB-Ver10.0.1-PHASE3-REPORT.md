# CHASS KEIBA LAB Ver.10.0.1 — PHASE 3 REPORT

## Phase

PHASE 3: Race Snapshot Cache / D1 Optimization

PHASE 4（Public Read-Only API）以降は未実施です。

## 結論

既存のPrediction / Market / Final / Result / Validation Snapshot、IndexedDB、D1 Differential Syncを維持したまま、無変更保存、単一レース同期、起動時Cloud読込、D1 Manifestの負荷を削減しました。予想式、JRA 12,000回Simulation、NAR通信、Similarity、AI Data Bridge、MCPは変更していません。

## 変更ファイル

- `app.js`
- `worker.js`
- `d1-schema.sql`
- `migrations/0003_race_fingerprints.sql`（新規）
- `tests/race-snapshot-cache.test.mjs`（新規）

## 変更関数

- `cloudDescriptor()` / `manifestMatches()`
- `persistRecordIfChanged()` / `persist()`
- `applyMarketOdds()` / `syncLiveOdds()`
- `syncRaceToCloud()` / `syncAllResearchToCloud()`
- `initCloudResearch()` / `refreshCloudResearchDataset()`
- `d1SyncDescriptor()` / `persistD1Fingerprints()`
- `saveD1Record()` / `readD1Manifest()`
- `readD1Records()` / `readD1ResearchDataset()`

## 実装内容

### 1. 無変更persistの早期終了

`researchContentFingerprint`が同じ場合、race SnapshotのIndexedDB保存、Cloud POST、D1 writeを実行しません。current race pointerだけ維持します。

### 2. Odds変更検出

オッズ値・人気順位のsignatureが同じ場合、Prediction/Market再保存を行いません。確認時刻は一時状態、実際の変更時刻は`oddsChangedAt`として分離しました。

### 3. 単一レース同期後の全Research再取得廃止

`/api/db/sync`の返却descriptorで対象raceのManifest cacheだけを更新します。同期のたびに`/api/db/research`を再取得しません。

### 4. 起動時の全Research取得を遅延化

起動時はD1 healthと軽量Manifestだけ確認します。研究全件はDashboard表示、明示的な再計算・復元時のみ取得します。IndexedDB/localStorageのSnapshotを先に表示します。

### 5. D1 Manifest軽量化

`races`へ以下のnullable fingerprint列を追加しました。

- `race_fp`
- `prediction_fp`
- `market_fp`
- `final_fp`
- `result_fp`
- `validation_fp`
- `live_fp`

Migration適用済み・fingerprint保存済みレコードは、Manifestで巨大Snapshot JSONをSELECTしません。旧レコードはnullのものだけJSONから安全に計算し、次回同期時に遅延補完します。Migration未適用環境では旧Schema読込へフォールバックします。

### 6. SELECT *縮小

race/research読込で必要列を明示し、fingerprintメタデータ等の不要列を研究データ本体へ含めないようにしました。

### 7. Storage Diagnostics

開発テスト用に、Cache Hit/Miss、IndexedDB read/write、D1 read/write、Cloud POST、Research Refresh、Odds/Result Fetch、無変更persistを計測可能にしました。推測値は記録しません。

## Migration

`migrations/0003_race_fingerprints.sql`は`ALTER TABLE ... ADD COLUMN`だけです。DROP、既存race_id変更、既存Snapshot変更はありません。

## Performance Acceptance

| ケース | 改修前 | 改修後（実測テスト） |
|---|---:|---:|
| 同一Snapshotを10回保存 | race保存/Cloud同期の対象 | race IndexedDB write 0、Cloud POST 0、D1 write 0 |
| 単一race Cloud同期後 | `/api/db/research`を予約再取得 | `/api/db/research` 0 |
| Cloud初期化 | health + manifest + research | health + manifest、research 0 |
| Migrated Manifest | Snapshot JSONからfingerprint算出 | scalar fingerprint SELECT 1回、Snapshot JSON SELECT 0 |

バイト数・本番D1実行時間は実環境計測を行っていないため不明です。架空値は記載していません。

## 既存機能への影響

- JRA予想、12,000回Simulation、Calibration: 変更なし
- NAR parser / transport / odds / result: 通信仕様変更なし
- Prediction Snapshot: 内容・固定仕様変更なし
- Scratch新仕様: 変更なし
- Historical Similarity: 計算式・候補母集団変更なし
- Background Collector: 変更なし
- AI Data Bridge: endpoint/schema/auth変更なし
- MCP Connector: tool/schema変更なし
- Public Read-Only API: 未着手

## テスト

追加テスト5件：

1. 同一Snapshot 10回でwrite/POST/refreshが0
2. 単一race同期後に全Research再取得しない
3. 起動時Research Datasetを遅延する
4. Migrated ManifestがSnapshot JSONを読まない
5. MigrationがadditiveでDROPを含まない

最終結果：`npm run check` 243/243 PASS、fail 0。

## Known Issues / 次Phase候補

- 旧D1レコードはfingerprint列が埋まるまで、その旧レコードだけManifestでJSON fallbackが必要です。
- `/api/db/research`は明示的なDashboard研究用途では引き続き最大5000件を読みます。cursor/date/organization filterの段階導入は将来候補です。
- SimilarityはWorker側で処理されますが、候補抽出の専用scalar index化は未実施です。
- 本番Cloudflare AnalyticsによるD1 read rows・latency・response bytesの比較は未実施です。

## Rollback

`app.js`、`worker.js`、`d1-schema.sql`をPhase 2版へ戻せばコア動作を戻せます。追加fingerprint列はnullableかつ未参照でも無害なため、D1でDROPする必要はありません。
