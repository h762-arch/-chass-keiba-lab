# CHASS KEIBA LAB Ver.9.9.31 完了報告

名称: ChatGPT Connector Bridge  
確認日時: 2026-09-01 08:59 JST

## 【確認できた事実】

### 1. 採用した接続方式

公式Model Context Protocol TypeScript SDKによる独立Node.js MCP Serverを採用しました。TransportはStreamable HTTP、endpointは`/mcp`です。CHASS本体と依存関係を分けるため、`mcp/`を独立packageにしています。

```text
ChatGPT / MCP Client
        ↓ Streamable HTTP
CHASS MCP Server（Read-Only）
        ↓ HTTPS GET + Bearer
CHASS AI Data Bridge /api/chass/v1/*
        ↓ SELECTのみ
Cloudflare D1
```

### 2. MCP / Connector構造

- `mcp/server.mjs`: Streamable HTTP MCP、tool登録、MCP入口認証
- `mcp/bridge-client.mjs`: AI Data Bridge専用GET client、timeout、1回retry、エラー正規化
- `mcp/chass-tools.mjs`: 6 tool、JST日付、競馬場alias、compact/full、provenance
- `mcp/package.json`: 本体とは独立した依存関係
- `mcp/.env.example`: secretを含まない設定例
- `mcp/README.md`: Worker、MCP、Inspector、ChatGPT接続手順

### 3. Tool一覧・入力schema・返却内容

| Tool | 入力 | 主な返却内容 |
|---|---|---|
| `chass_health` | なし | Bridge/D1状態、version、capabilities |
| `chass_get_race` | `raceId`、または`date+track+raceNo`、`detail` | Original、Live Adjusted、波乱、穴馬、取消、結果、検証 |
| `chass_get_latest` | `track?`, `limit 1..20`, `detail` | 最新保存予想 |
| `chass_get_pending` | `limit 1..20` | result waiting/pending/retry |
| `chass_get_research` | なし | validation、TIME、穴馬、波乱研究集計 |
| `chass_get_recent` | `limit 1..20`, `track?`, `date?`, `detail` | 直近の予想・結果・検証 |

すべてのToolに`readOnlyHint: true`、`destructiveHint: false`を設定しました。書込み、NAR再取得、再予想toolはありません。

### 4. Bearer Token保護・`.env`管理

- `CHASS_BRIDGE_TOKEN`はMCP内部からAI Data Bridgeの`Authorization` headerだけへ設定
- URL、tool output、consoleへtokenを出力しない
- `.env`、`.env.local`、`mcp/.env*`をGit対象外化
- 非loopback公開時はBridge tokenとは別の`MCP_ACCESS_TOKEN`を必須化
- CORSは`MCP_ALLOWED_ORIGIN`に完全一致するoriginだけ許可。wildcardなし
- 通常は`127.0.0.1`で起動し、ChatGPT Secure MCP Tunnel経由を推奨

### 5. AI Data Bridgeへの接続

許可したGET endpointは次の5本だけです。

- `/api/chass/v1/health`
- `/api/chass/v1/context`
- `/api/chass/v1/race`
- `/api/chass/v1/research`
- `/api/chass/v1/pending`

query parameterから任意URLやSQLを指定できません。NAR endpointとD1 write endpointはallowlist外です。timeoutは既定8秒、最大10秒、retryはGETの一時的失敗に1回だけです。

### 6. データ保持仕様

- Original Snapshotは`predictionMode: original`として正式研究予想を維持
- Live Adjustedは`predictionMode: live_adjusted`として分離
- 波乱指数、Race Confidence、穴馬・危険人気馬mark、結果、validationをBridge値から読取
- TIME欠損は`null`のまま保持し、0へ変換しない
- probabilityは`0-1`、Unicodeの印・馬名・競馬場名をUTF-8で維持
- `source: CHASS KEIBA LAB D1`、`generatedAt`、`sourceUpdatedAt`、`isStale`を返却
- 未確定データが30分以上更新されていない場合だけ`isStale: true`

### 7. エラー・サイズ・rate limit

`unauthorized`、`bridge_unavailable`、`race_not_found`、`invalid_request`、`timeout`、`rate_limited`、`database_unavailable`、`response_too_large`へ正規化しました。401、404、429、503、413をテスト済みです。

通常は`compact`、明示時だけ`full`を使用し、複数レースは最大20件です。既存AI Data Bridge側の100KB制限・429制御をそのまま正規データ源として利用し、MCP側で全D1取得や別集計は行いません。

### 8. セキュリティ・回帰確認

- SQL風のtrack文字列はURL encodingされ、任意SQLとして実行されない
- tokenなし・誤tokenは拒否
- D1 write、NAR fetch、prediction更新toolなし
- `/api/nar/race`、`/api/nar/sync`、`/api/nar/odds`、`/api/db/sync`の処理は変更なし
- D1 schema・保存ロジックは変更なし
- AI勝率、AI3着内率、TIME、能力、期待値、穴馬、危険人気馬、波乱指数、Race Confidenceは変更なし
- Original Snapshot / Live Adjustedの計算・保存処理は変更なし

### 9. テスト結果

- `npm run check`: **181 tests / pass 181 / fail 0**
- MCP単体: **15 tests相当（14 unit + 1 live integration）/ fail 0**
- 実接続テスト: 公式SDK Clientから`initialize`、`tools/list`、`chass_health`をStreamable HTTPで実行
- 6 tools列挙、Read-Only annotations、模擬AI Data BridgeへのBearer中継、D1 availability返却を確認
- `node --check app.js chass-latest.js worker.js server.mjs`相当およびMCP 3ファイル: fail 0

### 10. OpenAPI

既存AI Data Bridgeの`openapi.json`を維持し、各GET操作へ一意の`operationId`を追加しました。書込みAPIは追加していません。

## 【本環境では未確認】

- 実際のCloudflare本番URLと`CHASS_BRIDGE_TOKEN`は提供されていないため、本番D1への接続は未実施です。
- ChatGPTアカウントのDeveloper modeへの登録、Secure MCP Tunnel作成、実iPhone Safari確認は未実施です。
- GitHub push、Cloudflare deploy、外部公開は実施していません。

これは実装不備ではなく、外部環境・認証情報を勝手に変更しないための境界です。`mcp/README.md`の手順で本番secretを設定後、最初に`chass_health`を実行してください。

## 変更ファイル

- 新規: `.gitignore`
- 新規: `mcp/.env.example`
- 新規: `mcp/README.md`
- 新規: `mcp/bridge-client.mjs`
- 新規: `mcp/chass-tools.mjs`
- 新規: `mcp/package.json`
- 新規: `mcp/package-lock.json`
- 新規: `mcp/server.mjs`
- 新規: `tests/mcp-connector.test.mjs`
- 新規: `tests/mcp-live-integration.test.mjs`
- 新規: 本報告書
- 更新: `README.md`, `openapi.json`, `package.json`, `regression.test.mjs`
- versionのみ更新: `worker.js`, `server.mjs`, `app.js`, `index.html`, `tests/ai-data-bridge.test.mjs`

## 公式参考資料

- MCP Serverの構築: https://developers.openai.com/plugins/build/mcp-server
- ChatGPTへの接続: https://developers.openai.com/plugins/deploy/connect-chatgpt
- 公式MCP SDK quickstart: https://developers.openai.com/plugins/build/app-quickstart
