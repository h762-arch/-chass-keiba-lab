# Ver.9.9.22 Stable Transport Rebase 比較記録

| 項目 | Ver.9.9.8 | Ver.9.9.21 | Ver.9.9.22採用 |
|---|---|---|---|
| 予想取得 | `/api/nar/race`の単純経路 | retry・診断復旧を通常処理へ併設 | `/api/nar/race`の単純経路 |
| 結果取得 | `/api/nar/sync` | `/api/nar/sync-minimal`＋詳細transport制御 | `/api/nar/sync` |
| オッズ | `/api/nar/odds` | 独立API＋結果側optional | 独立API＋optional |
| 多重取得防止 | 単純な処理制御 | raceId別Map・generation・requestId | 単純な処理中Promiseロック |
| 復旧 | 通常失敗時のみ | 多段診断を通常制御へ統合 | 通常失敗時のみ診断API |
| D1 | D1研究基盤 | 差分同期・正式母集団・監査 | 現行機能を維持 |
| 検証UI | D1検証 | 拡張済み | 現行機能を維持 |
| 予想・穴馬 | 当時版 | 改善済み | 現行ロジックを維持 |

## 通常フロー

- 予想：ブラウザ → `/api/nar/race` → NAR公式 → 解析 → JSON
- 結果：ブラウザ → `/api/nar/sync` → RaceMarkTable → 解析 → optional odds → JSON
- オッズ：ブラウザ → `/api/nar/odds` → OddsTanFuku → JSON
- `/api/nar/result-diagnostic`は通常結果取得が失敗した場合だけ使用します。
- `/api/nar/race-diagnostic`は通常予想取得が失敗した場合だけ使用します。

## 保護対象

- `d1-schema.sql`と`wrangler.jsonc`は変更していません。
- IndexedDB/localStorageのキーは変更していません。
- predictionSnapshot、marketSnapshot、finalSnapshotの構造は変更していません。
- AI勝率、AI TOP3率、能力、TIME、期待値、穴馬判定、CHASS FINALは変更していません。
- 再取得失敗時も保存済み結果を維持します。

## 検査結果

- `node --check app.js` 成功
- `node --check chass-latest.js` 成功
- `node --check worker.js` 成功
- `node --check server.mjs` 成功
- 自動テスト 105件成功、失敗0件
