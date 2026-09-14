# CHASS AI Data Bridge v1

CHASSに保存済みのCloudflare D1研究データを、Bearer認証付きのGET専用JSON APIで参照します。BridgeはNARへアクセスせず、D1へ書き込みません。

## 本番設定

トークンはコードやURLへ入れず、Cloudflare Worker secretとして設定します。

```bash
npx wrangler secret put CHASS_BRIDGE_TOKEN
```

CORSが必要な場合だけ、許可する単一Originを `CHASS_BRIDGE_ALLOWED_ORIGIN` に設定します。未設定時はCORSヘッダーを返しません。`*` は使用しません。

## エンドポイント

- `GET /api/chass/v1/health`
- `GET /api/chass/v1/context?scope=latest&limit=20`
- `GET /api/chass/v1/context?scope=recent&limit=20&cursor=0`
- `GET /api/chass/v1/race?raceId=...`
- `GET /api/chass/v1/race?date=2026-09-01&track=大井&raceNo=8`
- `GET /api/chass/v1/research`
- `GET /api/chass/v1/pending`
- `GET /api/chass/v1/openapi.json`

互換入口として `GET /api/chass/context?scope=...` も利用できます。

```bash
curl -H "Authorization: Bearer $CHASS_BRIDGE_TOKEN" \
  "https://example.workers.dev/api/chass/v1/race?date=2026-09-01&track=%E5%A4%A7%E4%BA%95&raceNo=8"
```

## 安全性

- 認証済みGETだけを受け付けます（OpenAPI文書を除く）。
- D1へ渡せる文は固定の `SELECT` / `WITH` のみです。
- `raceId` 等をSQL文字列へ連結しません。
- 最大 `limit` は100、通常は20です。cursorで継続取得します。
- 100KBを超える応答は返さず、limit縮小を要求します。
- レート制御はWorker isolate内でIPごとに毎分60回です。厳密な分散レート制限が必要な場合はCloudflare Rate Limitingを併用してください。
- 最新・pending・race・researchはいずれも `Cache-Control: no-store` です。

ローカル `server.mjs` にはD1 bindingがないため、認証仕様とOpenAPIだけを提供し、データAPIは明示的に503を返します。
