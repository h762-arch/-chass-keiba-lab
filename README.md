# CHASS KEIBA LAB MCP Ver.9.9.34

CHASS AI Data BridgeをChatGPT/Codexへ接続する、独立したRead-Only MCP Serverです。データは保存せず、NARへ直接アクセスせず、`/api/chass/v1/*`のGETだけを中継します。

## 1. Cloudflare Workerを準備

Ver.9.9.30以降のWorkerをデプロイし、Bridge secretを設定します。

```bash
npx wrangler secret put CHASS_BRIDGE_TOKEN
```

`GET /api/chass/v1/health`がBearer認証付きで成功することを確認してください。

## 2. MCPを設定

```bash
cd mcp
cp .env.example .env
npm install
```

`.env`へ以下を設定します。

```dotenv
CHASS_API_BASE_URL=https://your-worker.example.workers.dev
CHASS_BRIDGE_TOKEN=Cloudflare側と同じsecret
MCP_HOST=127.0.0.1
MCP_PORT=8787
CHASS_HTTP_TIMEOUT_MS=8000
```

`CHASS_BRIDGE_TOKEN`はMCP内部だけで使用し、tool output、URL、ログへ出しません。`.env`と`.env.local`はGit管理対象外です。

## 3. 起動・検査

```bash
npm start
npx @modelcontextprotocol/inspector@latest
```

InspectorではStreamable HTTPを選び、次を指定します。

```text
http://127.0.0.1:8787/mcp
```

最初に`chass_health`を実行してください。

## 4. ChatGPTへ接続

安全な開発接続はSecure MCP Tunnelを推奨します。ChatGPTでDeveloper modeを有効化し、Pluginsの接続画面からTunnelを選び、このMCP Serverへ接続します。

公開HTTPSへ直接配置する場合は、`MCP_HOST=0.0.0.0`と別の`MCP_ACCESS_TOKEN`を必ず設定してください。ただし、ChatGPTへの一般公開・審査用途ではOpenAI公式要件に沿ったOAuth 2.1認証の追加が必要です。静的tokenをURLへ含めないでください。

公開URLを接続する場合のendpointは次の形式です。

```text
https://your-mcp.example.com/mcp
```

## Tool一覧

| Tool | 用途 | 主な入力 |
|---|---|---|
| `chass_health` | Bridge/D1接続確認 | なし |
| `chass_get_race` | 1レースのOriginal/Live/結果/検証/過去類似分析 | raceId、またはdate+track+raceNo、detail |
| `chass_get_latest` | 最新保存予想 | track、limit、detail |
| `chass_get_pending` | 結果未取得レース | limit |
| `chass_get_research` | 研究・穴馬・波乱集計 | なし |
| `chass_get_recent` | 直近の予想・結果・検証 | limit、track、date、detail |

全Toolは`readOnlyHint: true`、`destructiveHint: false`、`openWorldHint: false`です。書込みToolはありません。

## 日付・競馬場

- `date`: `YYYY-MM-DD`、`today`、`今日`
- `today`は`Asia/Tokyo`で絶対日付へ変換
- 日付を省略した「大井8R」は推測せず`invalid_request`
- `大井`、`おおい`、`Ohi`、`oi`等の明示済みaliasだけを正規化

## compact / full

- `compact`（既定）: レース基本情報、上位馬、穴馬、危険人気馬、波乱、結果状態、類似分析の主要指標と上位パターン
- `full`: 全馬、Original、Live Adjusted、結果、検証、上位類似レースと馬別Historical Support

Original Snapshotを正式な研究予想とし、Live Adjustedは別レイヤーとして返します。

## エラー

`unauthorized`、`bridge_unavailable`、`race_not_found`、`invalid_request`、`timeout`、`rate_limited`、`database_unavailable`、`response_too_large`を統一形式で返します。token内容は返しません。

## ChatGPT利用例

- 今日の大井8RをCHASSデータで分析して
- 今日の結果未取得レースを確認して
- 直近20Rの穴馬捕捉率を分析して
- 波乱指数70%以上の成績を検証して
- 取消前とLive予想を比較して

## 接続できたと確認する条件

1. MCP Inspectorで6 toolsが表示される
2. `chass_health`が`connected: true`、`databaseAvailable: true`
3. `chass_get_race`が保存済みレースを返す
4. ChatGPT Developer modeでMCPを追加後、上記の自然言語依頼から該当Toolが選択される
