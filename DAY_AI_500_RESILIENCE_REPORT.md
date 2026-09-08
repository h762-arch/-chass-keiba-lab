# CHASS KEIBA LAB Ver.10.0.1 — DAY-AI 500 Resilience

## 結論

`day-ai?format=compact` の集約経路を、能力ロジックを変更せずに強化した。

- 同一 raceNo の複数 `model_version` を、正式な最新スナップショット1件へ集約
- historical/background 行を最新当日予想より優先しない
- 固定 `LIMIT 24` / `LIMIT 48` を廃止し、対象日・競馬場の全候補行を取得後に dedupe
- malformed な1レースを他レースから隔離し、day 全体を `500` にしない
- day-level に `complete` / `partial` と利用可能レース数を追加
- `catch(error)` で内部ログへ stage・race・model・stack を記録
- 公開エラーは `errorCode`、`stage`、`requestId` 相当の安全な情報だけに限定
- `null` と `excluded` は従来どおり正常値として保持
- `ability-only` / `marketEvaluation: external` を維持

## ローカルで確認できた原因

旧集約処理には次の障害要因があった。

1. D1から複数モデル行を取得しても raceNo 単位の明示的な dedupe がなかった。
2. 固定件数取得後の `slice(0, 12)` に依存していたため、重複行があると別レースの欠落や旧モデル混入が起こり得た。
3. 全行を一括 `map` しており、1行の不正JSONまたはマッピング例外が day 全体の500になった。
4. 最終 `catch {}` が例外の stage と内容を捨てていた。

これらはコード上で確認できた根本的な脆弱性である。ただし、本番2026-09-09川崎で実際に発生した例外そのものは、本番D1およびCloudflareログへアクセスできない環境のため未確認である。

## テスト結果

- 構文チェック: 合格
- 全テスト: **313 / 313 合格**
- public read-only API対象: **31 / 31 合格**
- 12R連続3回テスト: HTTP 200相当を3回確認
- 12R / 24頭 fixture: cold 1ms、warm 0ms、8,009 bytes
- 216頭 compact fixture: 64,327 bytes（100KB未満）
- 重複モデルfixture: 最新正式スナップショットのみ採用
- malformed 1R fixture: 残り11Rを返し `partial`
- 市場評価フィールド: compactには追加なし
- 能力値・確率・TIME・適性・runnerStatus: ロジック変更なし

## 本番で必要な最終確認

デプロイ後に次を確認すること。

1. Cloudflareログで2026-09-09川崎の実例外 stage を確認
2. 本番D1の raceNo別行数・model_version・選択行を確認
3. 2026-09-09川崎 day-ai compact を3回連続実行
4. 2026-09-08川崎 day-ai compact の回帰確認
5. race compact と day-ai 内の同一馬の能力値一致確認

本番確認前に「実際の500原因を断定」「本番修復完了」とは扱わないこと。
