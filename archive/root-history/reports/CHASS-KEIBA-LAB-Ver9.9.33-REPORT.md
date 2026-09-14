# CHASS KEIBA LAB Ver.9.9.33 完了報告

名称: **Historical Meeting-Aware Collector**  
報告日時: **2026-09-01 11:43:30 JST**

## 結論

Historical Research Collectorを、全日付×全場×1〜12Rの事前全展開から、NAR公式RaceListを用いる開催日認識型へ変更した。既存の `/api/nar/race`、`/api/nar/sync`、`/api/nar/odds` は変更せず、新しい `/api/nar/meeting` はCollectorの対象発見専用である。

## 1. 旧historyPlan()の問題点

- `dates × tracks × 12` を開始時に全配列化していた。
- 非開催日でも1R〜12Rを順番に問い合わせていた。
- 11R開催でも12R候補を作成していた。
- 非開催・対象外レース・通信障害が「スキップ/失敗」に混在した。
- iPhoneで候補配列と進捗状態が不必要に大きくなった。

旧 `historyPlan()` は削除した。

## 2. 新Collectorフロー

1. Meeting Discovery: 日付×選択競馬場を遅延走査
2. Race Discovery: NAR公式RaceListから実在レース番号を抽出
3. Collection: 発見済みレースだけを順次 `/api/nar/race` → `/api/nar/sync`
4. Local/D1保存: 既存 `historical_research / backtest_prediction` 経路を使用

全レースplan配列は作らず、`meetingCursor`、`collectionMeetingIndex`、`raceIndex` で再開する。

## 3. Meeting Discovery方式

- URL: `/KeibaWeb/TodayRaceInfo/RaceList`
- query: `k_babaCode`、`k_raceDate`
- 1回のHTMLから開催場・開催日・レース番号を検証する。
- Requested date/trackが一致し、1件以上のレース番号がある場合だけ `meeting`。
- 同日ページが別競馬場へ明示的に切り替わった場合は `non_meeting`。
- メンテナンス、空HTML、日付不一致、レース番号欠損は `meeting_unknown`。
- `meeting_unknown` は最大3回（初回、2秒後、5秒後）試行し、非開催として保存しない。

## 4. Race Discovery方式

RaceList内の `k_raceNo` と表示上の `nR` を抽出し、1〜20の範囲で重複排除・昇順化する。12R固定は廃止した。11Rまでの一覧では `[1..11]` のみを収集する。

## 5. meetingCalendarCache仕様

- key: `YYYY-MM-DD_競馬場`
- value: `status`、`raceNumbers`、`checkedAt`、`source`
- 保存先: `localStorage(chass_meeting_calendar_v1)` と既存IndexedDB `settings/meetingCalendar`
- 保存対象: `meeting`、`non_meeting` の確定値のみ
- 非保存: `meeting_unknown`、network/timeout/HTTP/parse障害
- 過去日は長期利用。手動の「開催日キャッシュをリセット」でのみ削除可能。

## 6. 非開催判定方法

同一日付でNARページが別の開催場を明示した場合、または公式の「開催/レース情報なし」表示がある場合だけ `non_meeting` とする。1Rがないだけでは非開催と判定しない。

## 7. raceNumbers取得方法

RaceListリンクの `k_raceNo` を主とし、表示上の `1R` 等を補助として解析する。URLエンティティ `&amp;` にも対応した。

## 8. 非開催と通信失敗の分類

| 状態 | 集計 | 失敗扱い |
|---|---:|---:|
| saved | 保存 | いいえ |
| already_saved | 既取得 | いいえ |
| non_meeting | 非開催日 | いいえ |
| race_not_scheduled | 対象外R | いいえ |
| result_waiting | 結果待ち | いいえ |
| network_failure / timeout / HTTP異常 | 通信失敗 | はい |
| parse_failure | 解析失敗 | はい |
| unexpected_exception | 予期しない失敗 | はい |

## 9. Resume仕様

`phase`、`meetingCursor`、`collectionMeetingIndex`、`raceIndex`、`discoveredMeetings`、各統計を保存する。再開時は確定済みmeeting cacheを再利用し、Meeting Discoveryをやり直さない。判定不能の組だけは `meeting_retry` で再確認する。

## 10. 進捗計算変更

- 探索中: `開催日探索 n / 日付×選択場`
- 探索後: `レース収集 n / 実在R`
- 競馬場別: 開催日、非開催日、収集R/対象R
- 集計: 保存、既取得、非開催、対象外R、結果待ち、通信失敗
- 効率: 旧候補、実NAR要求、推定削減率、cache hit

## 11. D1変更

**変更なし。migrationなし。** 既存races/predictions/results、DB binding、保存APIを維持した。

## 12. IndexedDB変更

schema version、object storeとも変更なし。既存 `settings` storeへ `meetingCalendar` 1件を追加するだけで、過去レースは変更・削除しない。

## 13〜15. request数・処理時間・非開催アクセス削減

ライブ30日収集は本環境から本番D1/NARへ実行していないため、実測値ではなくテスト済みシナリオ値を示す。

30日・大井・開催6日・実在72Rの例:

| 指標 | 旧方式 | 新方式 |
|---|---:|---:|
| 事前候補 | 360R | 30 date×track |
| race取得要求 | 360 | 72 |
| result要求 | 72 | 72 |
| meeting要求 | 0 | 30 |
| 合計NAR要求 | 432 | 174 |
| 推定削減 | — | 59.7% |

非開催24日について、旧方式の2R〜12R相当264要求は0になる。Collector UIは実行時の実要求数と削減率を表示する。旧方式のレース間待機だけで約378秒、新方式は約75.6秒となるシナリオだが、ネットワーク時間を含む総処理時間は本番実行後の実測が必要。

## 16. iPhone Safari確認

- 4,680件plan配列を廃止し、日付・場・レースのindexだけで再開。
- 1通信ずつのsequential処理を維持。
- 手動予想、手動結果、オッズ、自動結果取得を優先し、既存通信をabortしない。
- 700〜1,400msのレース間隔を維持。
- 430px以下では操作ボタンと集計カードを2列へ折り返すCSSを維持。
- 実機Safari/4G/5G試験はこの環境では未実施。コード・レスポンシブCSS・自動テストによる確認である。

## 17〜21. 非変更確認

- Historical Similarity: 式、weights、version、success/failure patternsを未変更。
- AI Data Bridge: v1 APIとschema 1.1を未変更。
- MCP: 6 Read-Only toolsの仕様を未変更。表示versionのみ9.9.33。
- NAR通信本体: `/api/nar/race`、`/sync`、`/odds` を未変更。
- 予想ロジック: AI勝率、AI3着内率、TIME、能力、期待値、穴馬、危険人気馬、波乱指数、Race Confidenceを未変更。
- Original/Live、Auto Result Queue、D1保存を未変更。
- `backtest_prediction` は従来どおりリアルタイム成功/失敗学習へ混入させない。

## 22. 全テスト結果

実行:

```text
node --check app.js
node --check chass-latest.js
node --check worker.js
node --check server.mjs
node --check meeting-discovery.mjs
npm run check
```

結果: **207 passed / 0 failed**

追加確認:

- 12R開催を1 RaceListで発見
- 11R開催で12Rを生成しない
- 同日別場レスポンスをnon_meetingへ分類
- 曖昧/日付不一致をmeeting_unknownへ分類
- official RaceList URL/parameter
- request削減KPI
- 巨大plan廃止
- 既取得race_idスキップ
- resume cursor
- progress resetとcache resetの分離

## 23〜24. 配布物

- PATCH ZIP: `CHASS-KEIBA-LAB-Ver9.9.33-Meeting-Aware-Collector-PATCH.zip`
- FULL ZIP: `CHASS-KEIBA-LAB-Ver9.9.33-Historical-Meeting-Aware-Collector-FULL.zip`

## 変更ファイル

- `meeting-discovery.mjs`（新規）
- `app.js`
- `worker.js`
- `server.mjs`
- `index.html`
- `styles.css`
- `package.json`
- `mcp/package.json`
- `mcp/package-lock.json`
- `mcp/chass-tools.mjs`（versionのみ）
- `README.md`
- `mcp/README.md`
- `tests/history-collector.test.mjs`
- `tests/meeting-discovery.test.mjs`（新規）
- version assertion tests

## GitHub

GitHubへは未反映。

## 公式参照

- NAR地方競馬情報サイト「当日メニュー / RaceList」
- NAR地方競馬情報サイト「月間開催日程」
- NAR地方競馬情報サイト「初心者ガイド（当日メニュー説明）」
