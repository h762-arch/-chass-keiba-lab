# Market Integrity 修正報告

対象: Ver10.0.1 / ローカル修正版。未デプロイ。

変更ファイル: worker.js, server.mjs, tests/public-read-only-api.test.mjs
変更関数: publicPopularityMap, publicDayAi, publicMarketFreshness(追加), server parseTanFuku(重複削除しWorkerから共通利用)。

- オッズ欠損時は人気・期待値・順位・市場差・diamond/warningと理由、互換用longshot/dangerを無効化。
- horseNumber/horseName/winProb/top3Probを追加。従来キーは維持。
- 保存オッズの更新時刻が5分超または不明ならstale。最終オッズは期限切れ判定対象外。これはAPIの鮮度表示方針であり、確率や能力計算には適用しない。
- ローカルサーバーのオッズ解析をWorkerと共通化。
- 予想モデル・D1スキーマ・保存済みPredictionは変更なし。

検証: 対象27/27成功。最終 npm run check 299/299成功、失敗0。
追加テスト: 古い人気/印を保持する欠損データ、JSON互換キー、古いオッズのstale表示。

制限: 本番オッズ取得原因・川崎実オッズの復旧・iPhone実機は未確認。保存済みデータにオッズがなければ、このAPI変更だけで実オッズが増えることはない。Public APIから外部取得/書込みは追加していない。

適用: このFULLソースを既存手順でデプロイし、アプリでオッズ取得・D1保存後day-aiを再確認する。Secret設定をZIPへ追加しない。
Rollback: 適用前デプロイへ戻す。Migration不要。
