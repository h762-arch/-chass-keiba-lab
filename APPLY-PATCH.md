# DAY-AI COMPACT PATCH

## 適用

1. 現行ソースをバックアップする。
2. `worker.js` と `app.js` をプロジェクト直下へ上書きする。
3. テストを更新する場合は `tests/` の2ファイルを同じ場所へ上書きする。
4. `npm run check` を実行し、失敗0を確認する。
5. 既存Cloudflare手順でデプロイする。

MigrationおよびSecret変更はない。

## 外部AI用URL

`/api/chass/v1/public/day-ai?date=YYYY-MM-DD&track=競馬場&organization=NAR&format=compact`

さらに小さくする場合は `format=tabular` を使用する。
詳細は `/api/chass/v1/public/race-ai?date=YYYY-MM-DD&track=競馬場&organization=NAR&race=1` を使用する。

## 注意

このPATCHは現在の会話で作成したVer10.0.1修正版を前提とする。古い版へ部分適用する場合は、依存するPublic API実装の有無を確認する。
本番デプロイおよび本番川崎データでの413解消は未確認。
