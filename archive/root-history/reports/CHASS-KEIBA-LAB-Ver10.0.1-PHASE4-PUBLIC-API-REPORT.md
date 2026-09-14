# CHASS KEIBA LAB Ver.10.0.1 — PHASE 4 PUBLIC API REPORT

## 結論

PHASE 4「Free Public Read-Only Prediction API」を実装しました。Cloudflare D1の保存済みSnapshotだけを読み、JRA/NAR外部取得、予想再計算、D1書込を行わない独立経路です。既存Bearer認証付きAI Data BridgeとMCPは維持しています。PHASE 5以降は未実施です。

## 変更ファイル

- `worker.js`
- `server.mjs`
- `app.js`
- `index.html`
- `styles.css`
- `README.md`
- `tests/public-read-only-api.test.mjs`（新規）

## Public API一覧

| Method | Endpoint | 内容 |
|---|---|---|
| GET/HEAD | `/api/chass/v1/public/health` | 公開API・D1接続状態 |
| GET/HEAD | `/api/chass/v1/public/latest` | 最新保存予想1件 |
| GET/HEAD | `/api/chass/v1/public/recent` | 直近保存レース一覧、最大20件 |
| GET/HEAD | `/api/chass/v1/public/races` | 日付・競馬場別の保存レース一覧 |
| GET/HEAD | `/api/chass/v1/public/race` | 指定レースのOriginal Prediction |
| GET/HEAD | `/api/chass/v1/public/result` | Original Predictionと結果の読取結合 |
| OPTIONS | `/api/chass/v1/public/*` | CORS preflight |

POST、PUT、PATCH、DELETEは405です。

## Race指定

例：

`/api/chass/v1/public/race?date=2026-09-01&track=大井&race=10&organization=NAR`

`organization`は`JRA`または`NAR`です。競馬場から一意に判断可能なら省略できます。曖昧な場合は`ORGANIZATION_REQUIRED`です。

競馬場alias例：

- 大井：`大井`、`Ohi`、`oi`、`TCK`
- 新潟：`新潟`、`Niigata`
- 中京：`中京`、`Chukyo`
- 札幌：`札幌`、`Sapporo`

不明なaliasは推測せず`INVALID_PARAMETER`です。

## Schema

Full responseは以下をwhitelistして返します。

- Race identity：organization、raceId、date、track、raceNo、raceName、surface、distance、going、startTime、fieldSize
- Model：appVersion、predictionMode、generatedAt
- Ability：ability score、TOTAL、脚質、斤量、馬体重、保存済みtimeIndex
- Probability：AI勝率、AI TOP3率、scale、valid
- TIME：標準値と表示値。未保存scenarioはnull
- Market：odds type、odds、人気、期待値、更新時刻
- 💎：level、mark、type、reason
- ⚠️：level、mark、reason
- Pace scenario：保存済み値のみ。未保存値はnull
- runnerStatus
- Sources / Timestamps

`format=compact`ではAI参照に必要な主要値だけを返します。

## Probability Validation

出力時に以下を検査します。

- `0 <= win <= 1`
- `0 <= top3 <= 1`
- `top3 >= win`

異常値は補正しません。`validation.probabilityValid=false`を返します。予想モデル・D1 Snapshotは変更しません。

## Result API

結果とOriginal Predictionを読取時に結合します。

- Finish / Actual TIME / Last3F / Passing
- Final Odds / Final Popularity（保存済みの場合）
- Original Mark / AI Win / AI TOP3 / Predicted TIME
- TIME Error
- Original 💎 / ⚠️
- runnerStatus

結果によるPrediction書換えはありません。

## Security

- raw D1 recordを返さずwhitelist serializerを使用
- Secret、env、Authorization、SQL、stack traceを非公開
- Public handlerはBearer Bridge handlerより前で独立分岐
- D1はread-only wrapper経由。SELECT/WITH以外を拒否
- Public APIからNAR/JRA fetch、予想計算、D1 writeを実行しない
- 最大レスポンス100KB。超過時413
- `ENABLE_PUBLIC_API=false`で公開経路だけ停止可能
- CORS：`Access-Control-Allow-Origin: *`
- 許可method：GET、HEAD、OPTIONS

## Rate Limit

Public専用に通常120 requests/60秒のbest-effort limiterを分離しました。Worker isolate内制御のため、厳密な全エッジ統合制限ではありません。必要時はCloudflare側Rate Limitingへ移行可能です。

## Cache Policy

- health：60秒
- recent/races：60秒
- 未確定race/latest：30秒
- Result確定済みrace/result：3600秒
- error：no-store

既存Bridge・Result transport・write responseの`no-store`は変更していません。

## UI

小さな折りたたみ「AI連携API」を追加しました。

- Public API：ON
- Read-Only
- API v1
- API接続確認
- 現在レースAPI URLをコピー

メイン予想カードのレイアウト・情報量は変更していません。

## D1変更

PHASE 4によるSchema変更・Migration追加はありません。PHASE 3のfingerprint列を含む既存Schemaを利用します。

## 既存機能への影響

- JRA Phase 1 / 12,000回Simulation / Calibration：変更なし
- NAR parser / transport / odds / result：変更なし
- Snapshot固定：変更なし
- Historical Collector / Similarity：変更なし
- AI Data Bridge：endpoint、Bearer認証、レスポンス維持
- MCP：6 tools、認証、接続方式維持
- Scratch status-only仕様：変更なし

## テスト結果

Public API追加テスト11件：

1. NAR/JRA競馬場alias
2. unauthenticated health
3. JRA raceと確率矛盾非補正
4. NAR、Unicode、TIME null、除外馬
5. compact/latest/recent/races上限
6. resultとOriginal Prediction結合
7. parameter/not found/result not found
8. write method拒否、HEAD/OPTIONS
9. Public専用rate limit
10. Secret/SQL/raw column非露出
11. 最小UI

最終：`npm run check` 254/254 PASS、fail 0。

## Cloudflareデプロイと確認

1. PHASE 3の`0003_race_fingerprints.sql`が未適用なら先に適用
2. 通常のWorkerデプロイを実施
3. `https://<worker-domain>/api/chass/v1/public/health`を開く
4. `ok=true`、`mode=read-only`、`database=true`を確認
5. アプリの「API接続確認」を実行
6. 保存済みレースで「現在レースAPI URLをコピー」を実行

実Workerへのデプロイおよび実URL疎通は今回実行していないため、現時点では確認できません。

## Known Issues

- Public race読取は既存Research Dataset readerを共有します。D1件数が大きくなった場合は、organization/date/track/raceNo scalar indexによる単一race Queryが次の最適化候補です。
- isolate内rate limitはbest-effortです。
- 保存されていないTIME scenario、timeIndex、pace probabilityはnullです。API用の推測生成は行いません。
- 実環境のresponse latency、D1 read rows、cache hit率は未計測です。

## Rollback

`worker.js`のPublic handler分岐と、`server.mjs`、`app.js`、`index.html`、`styles.css`のPublic UI部分を戻します。D1 MigrationはないためDB rollbackは不要です。AI Data BridgeとMCPは独立して残ります。
