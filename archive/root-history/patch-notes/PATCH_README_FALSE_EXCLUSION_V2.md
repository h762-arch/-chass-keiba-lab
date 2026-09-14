# False Exclusion v2 Patch

Ver.10.0.1プロジェクトへ、ZIP内の相対パスを維持して上書きしてください。

## 変更ファイル

- `worker.js`
- `server.mjs`
- `app.js`
- `meeting-discovery.mjs`
- `tests/scratch-live-adjustment.test.mjs`
- `tests/meeting-discovery.test.mjs`

適用前に既存ファイルをバックアップしてください。

適用後：

```bash
npm run check
```

その後、9/9川崎4Rを再取得し、12番ミストラがactive表示へ戻ることを確認してください。
