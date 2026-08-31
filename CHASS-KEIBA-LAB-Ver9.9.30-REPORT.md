# CHASS KEIBA LAB Ver.9.9.30 完了報告

作成日時（日本時間）: 2026-09-01 08:02 JST  
名称: CHASS AI Data Bridge

## 【確認できた事実】

### 1. AI Bridge API一覧

- `GET /api/chass/v1/health`
- `GET /api/chass/v1/context?scope=latest|recent|race|research|pending`
- `GET /api/chass/v1/race?raceId=...`
- `GET /api/chass/v1/race?date=YYYY-MM-DD&track=競馬場&raceNo=N`
- `GET /api/chass/v1/research`
- `GET /api/chass/v1/pending`
- `GET /api/chass/v1/openapi.json`
- 互換入口: `GET /api/chass/context?scope=...`

未定義のBridge pathとscopeは、それぞれ404/400で拒否します。

### 2. 認証方式

`Authorization: Bearer <token>` を使用します。トークンは `CHASS_BRIDGE_TOKEN` Cloudflare Worker secretからのみ読み、コード・URL・OpenAPIへ埋め込みません。secret未設定は503、誤トークン・未認証は401です。

### 3. Read-Only保証方法

- 外部APIはGET/OPTIONSのみ。POST等は405です。
- Bridge用D1ラッパーは固定の`SELECT`/`WITH`だけを実D1へ渡します。
- 既存readerの`CREATE TABLE/INDEX IF NOT EXISTS`確認はBridge経由ではno-op化します。
- `INSERT`、`UPDATE`、`DELETE`、任意SQL、query parameter由来SQLを実行する経路はありません。
- raceId/date/track/raceNoは読取済みホワイトリストデータとの照合にのみ使います。
- AI BridgeはNARへアクセスしません。

### 4. D1から取得する項目

既存の`races`、`predictions`、`results`を読む共通研究readerを再利用し、race/prediction/market/final/result/validation JSONをホワイトリスト変換します。D1 schema変更・migrationはありません。

### 5. race取得仕様

raceId、またはdate+track+raceNoで1レースを取得します。レース基本情報、馬別予想、予想軸、波乱指数、結果、検証、取消、結果待ち状態を返します。存在しないレースは404 `race_not_found`です。

### 6. latest取得仕様

新しい順に最新予想を返し、`limit`既定20・最大100、`cursor`で継続取得します。summary、pending、直近結果、直近検証、research/longshot/volatility集計も同梱します。

### 7. pending取得仕様

`result_waiting`、`result_pending`、`result_retry`、`prediction_saved`だけを返します。attempts、nextCheckAt、lastErrorを保持します。

### 8. research取得仕様

既存D1研究母集団からvalidatedRaceCount、evaluatedHorseCount、TOP3捕捉、TIME MAE、期待値100%以上、7/10人気以下、model別、穴馬、波乱較正を集計します。NAR再取得や別母集団は使用しません。

### 9. Original / Liveの扱い

`original`と`liveAdjusted`を別オブジェクトで返します。D1にLiveが存在しないレースは`liveAdjusted: null`です。BridgeはOriginal SnapshotもLiveも書き換えません。

### 10. TIME欠損の扱い

TIME欠損は`predictedTimeSeconds: null`とし、0に変換しません。既存の`predictedTimeMissingReason`を返し、未設定時だけ`time_missing_unknown`です。

### 11. 波乱指数の扱い

保存済みのvolatilityIndex、confidence、similarRaceCount、similarUpsetRate、stabilityScore、raceConfidenceを読み取り変換します。再計算・式変更はありません。

### 12. 穴馬データの扱い

longshotMark/type、dangerMark、expectedValue、marketGapと集計値を返します。穴馬・危険馬の判定ロジックは変更していません。

### 13. APIレスポンスサイズ

- 空データ基準: context 1,390 bytes / research 1,268 bytes / pending 339 bytes
- populated fixture: 100KB未満を自動テストで確認
- 100,000 bytes超過時: HTTP 413 `response_too_large`。limit縮小とcursor利用を要求

### 14. rate limit

Worker isolate内で接続IPごとに60 requests/minuteです。429と`Retry-After: 60`を返します。

### 15. CORS設定

`CHASS_BRIDGE_ALLOWED_ORIGIN`と完全一致するOriginだけを許可します。未設定・不一致ではCORSヘッダーを返さず、`*`は使用しません。

### 16. OpenAPI

`openapi.json`および`/api/chass/v1/openapi.json`を追加しました。GET read-only操作とBearer schemeのみで、実トークン・書込みAPIは含みません。

### 17. 既存NAR通信未変更確認

`/api/nar/race`、`/api/nar/sync`、`/api/nar/odds`のルート・NAR URL・パーサーは変更していません。既存通信回帰テストを含む全件が成功しています。

### 18. 既存D1保存未変更確認

`/api/db/sync`、D1 binding、schema、保存済みデータを変更・削除していません。DROP/DELETE/migrationはありません。

### 19. 予想ロジック未変更確認

AI勝率、AI3着内率、TIME、期待値、波乱指数、Race Confidence、穴馬、危険人気馬の算出処理は変更していません。

### 20. 全テスト結果

- `npm test`: 166 tests / pass 166 / fail 0
- `npm run check`: 構文チェック4ファイル + 全テスト / fail 0
- 新規Bridgeテスト: 認証、race、日付検索、pending、research、Original/Live、TIME null、D1障害、GET無書込み、SQL injection、method拒否、scope/path拒否、CORS

### 21. 変更ファイル

- `worker.js`
- `server.mjs`
- `app.js`
- `index.html`
- `package.json`
- `regression.test.mjs`
- `README.md`
- `openapi.json`（新規）
- `AI_BRIDGE.md`（新規）
- `tests/ai-data-bridge.test.mjs`（新規）

### 22. GitHub / デプロイ

GitHubへのpushおよびCloudflareへのdeployは実行していません。`CHASS_BRIDGE_TOKEN` secret設定後にデプロイしてください。

## 【推測・運用上の注意】

- isolate内rate limitは軽量な防御です。複数isolateを横断する厳密な上限が必要ならCloudflare Rate Limitingの併用が適切です。
- ChatGPT Connector/MCPへの実接続には、公開HTTPS endpoint、secret設定、許可Originまたはサーバー間認証の最終設定が別途必要です。
- ローカル`server.mjs`にはD1 bindingがないため、認証とOpenAPIを確認できますが、データendpointは意図的に503を返します。
