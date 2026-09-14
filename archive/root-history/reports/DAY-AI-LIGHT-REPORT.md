# day-ai 軽量化報告

## 確認と変更

- 現行コードの publicJson/publicText は100,000バイト超で413を返す。実運用の413本文は取得環境の制限で未確認。
- 既存day-ai既定出力は維持。`format=compact`を外部AI向け軽量オブジェクトJSON、`format=tabular`を超軽量な列＋行JSONとして追加。数値計算は既存 publicDayAi と共通。
- 過去走/rawデータを公開しない。全馬・指定13項目を保持し、容量削減目的の切捨てはしない。
- 旧詳細形式は format=full、既存テキスト形式は format=text で利用可能。旧既定スキーマに依存する利用者は format=full に移行が必要。
- race-ai は既存の公開 race handlerを共有する詳細取得用エイリアス。day-ai各レースのdetailUrlから取得可能。
- APIの100,000バイト安全制限は維持。極端に長いデータでは単一レースAPIを使用する。全データについて無条件の容量保証はしない。
- day-aiキャッシュは30秒。鮮度表示を含むため、結果取得済みであっても1時間キャッシュにしない。

## スキーマ

compact日単位: date, track, organization, raceCount, totalHorseCount, marketDataAvailable, oddsCoverage, generatedAt, apiVersion, format, races。

compactレース: raceNumber, raceName, horseCount, raceVolatility, raceValueScore, favoriteReliability, horses。

compact馬: horseNumber, horseName, abilityRank, score, winProb, top3Prob, odds, popularity, expectedValue, evRank, abilityPopularityGap, diamond, warning。確率は4桁、オッズは1桁、期待値は2桁に丸める。

tabular日単位: ok, apiVersion, mode, date, track, organization, raceCount, generatedAt, schemaVersion, format, horseColumns, races。

レース: raceNumber, raceName, raceVolatility, raceValueScore, favoriteReliability, horseCount, market, validation, detailUrl, horses。

horseColumns: horseNumber, horseName, abilityRank, score, winProb, top3Prob, odds, popularity, expectedValue, evRank, abilityPopularityGap, diamond, warning。

horsesの各要素はhorseColumnsと同じ順番の配列。例: `[1,"馬名",1,92,0.2,0.5,4.5,2,0.9,3,1,"💎",null]`。

市場の鮮度・取得率・取消状態・確率検査を維持。期待値は倍率（1.0=100%）。欠損はnull。

## テスト

- 12R×18頭=216頭の合成fixture: 旧詳細形式413、compact版200・51,146バイト、tabular版200・17,322バイト。
- 全12R・216頭保持、raw情報非公開、各馬の出力値と旧詳細形式が一致。
- race-ai詳細取得、404、POST/PUT/PATCH/DELETEの405、HEAD本文なしを確認。
- npm run check: 301/301成功、失敗0。
- 上記サイズは合成データであり、川崎の本番サイズではない。

## 変更ファイル

worker.js（compact/tabular serializer、公開handler）、app.js（コピーURLへformat=compact）、tests/public-read-only-api.test.mjs、tests/active-race-integrity.test.mjs、本報告。
予想モデル・UI・D1スキーマ・MCP・認証Bridgeは変更なし。

## 適用

FULLソースを既存のCloudflareデプロイ手順で適用。
従来のday-ai URLをそのまま開くと軽量形式になる。
深掘り時はdetailUrlを開く（同じWorkerのURLを先頭に付ける）。
旧形式は同じURLに &format=full を付ける。ただし大容量時は413となる。
本作業ではデプロイ・D1書込・外部オッズ取得を実施していない。
Rollbackは適用前のWorkerデプロイへ戻す。Migration不要。

## 未確認

本番のレスポンス本文、実オッズ取得復旧、ChatGPT取得環境での本番解析成功は未確認。
JSONの1行表示だけでは解析不能と断定できない。今回のローカル再現原因はJSON容量上限。
