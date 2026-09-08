# DAY-AI LIGHT PATCH 適用方法

対象は、直前の `CHASS-Ver10.0.1-MARKET-INTEGRITY-FULL` 適用済み環境です。

1. 既存ソースをバックアップする。
2. `worker.js` をプロジェクト直下の同名ファイルへ上書きする。
3. テストも更新する場合は `tests/public-read-only-api.test.mjs` を同じ場所へ上書きする。
4. `npm run check` を実行し、失敗0を確認する。
5. 既存のCloudflare手順でデプロイする。

本番D1のMigrationやSecret変更はありません。
予想ロジック、UI、app.js、server.mjs、MCP、AI Data Bridgeは今回のPATCH対象外です。

未確認事項: 本番の413解消、川崎の実オッズ取得、ChatGPT側からの本番取得。
