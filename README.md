# CHASS KEIBA LAB MCP

Read-only connector for saved CHASS D1 snapshots through the AI Data Bridge.

```sh
npm ci --prefix mcp
cp mcp/.env.example mcp/.env
npm run check --prefix mcp
npm start --prefix mcp
```

The connector exposes six read-only tools: `chass_health`, `chass_get_race`, `chass_get_latest`, `chass_get_pending`, `chass_get_research`, and `chass_get_recent`. It does not fetch JRA/NAR official sites and does not write predictions or D1 data.
