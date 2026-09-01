# CHASS KEIBA LAB Ver.9.9.34 完了報告

名称: Cloud Background Historical Collector

## 実装結果

1. **Background Job構造**  
   Safariは期間・競馬場をJob登録し、D1を正として開始・一時停止・再開・状態表示を行います。収集本体はWorkerの`runBackgroundHistoricalCollector()`です。
2. **D1 schema変更**  
   `meeting_calendar`と`historical_collector_jobs`を追加しました。`migrations/0002_background_historical_collector.sql`は`CREATE TABLE/INDEX IF NOT EXISTS`だけで、DROP・既存行更新はありません。
3. **Job status**  
   `queued / running / paused / completed / failed / cancelled`をschema上の語彙として採用し、現行フローは`running / paused / completed / cancelled`を使用します。
4. **phase管理**  
   `meeting_discovery → race_discovery → collection → completed`。cursorと対象一覧を`state_json`へ保存します。
5. **Cron統合**  
   既存`*/5 * * * *`を再利用し、`scheduled()`からAuto Result、Historicalの順に実行します。triggerの重複追加はありません。
6. **batch上限**  
   通常はMeeting最大3組またはRace最大3Rです。Auto Resultが1〜2件なら1件へ縮小、3件以上ならHistoricalをskipします。
7. **実行時間制御**  
   内部deadlineは18秒です。未完了は`running`のまま保存し、次回Cronへ継続します。NAR処理は逐次実行し、実fetch後に750ms間隔を置きます。
8. **Job lock**  
   D1の条件付き`UPDATE ... RETURNING`と`locked_until`を使い、TTLは2分です。取得できない重複Cronは処理しません。
9. **pause/resume**  
   pauseは`paused`化して`next_run_at`を外し、resumeは保存済みphase/cursorを維持したまま`running`へ戻します。
10. **Safari終了後**  
    設計上はWorker Cronだけで継続し、ブラウザJSへ依存しません。実機Safari終了後の本番確認は未実施です。
11. **Meeting Cache**  
    D1の`meeting_calendar(date,track)`を最初に参照します。hit時はNARへアクセスしません。
12. **非開催skip**  
    `non_meeting`確定後はレース番号を生成せず、2R〜12Rを呼びません。`meeting_unknown`は非開催へ変換しません。
13. **既取得race skip**  
    `races`のrace_id存在確認を先に行い、存在時はrace/result fetchと再保存を行いません。
14. **Auto Result優先**  
    scheduled内でAuto Resultを先行実行し、処理量に応じてHistorical batchを動的縮小します。
15. **Similarity連携**  
    保存データはD1研究datasetへ入ります。ただし既存仕様どおり`backtest_prediction`は未来リーク防止のためSimilarityの成功・失敗学習候補から除外されます。Similarityロジック自体は未変更です。
16. **UI変更**  
    `BACKGROUND COLLECTOR`、状態、最終実行、次回概算、run数、last batch、開催探索/収集進捗を追加。45秒pollingはJob APIだけを読み、NARへアクセスしません。
17. **iPhone Safariテスト**  
    コード上で画面非表示時poll停止、復帰時D1再読込を確認しました。375/390/393/430pxの実機目視とSafari完全終了後の本番Cronは未確認です。
18. **複数端末テスト**  
    API状態遷移と単一active Job、D1 lockを自動テストしました。実端末2台での同時操作は未確認です。
19. **NAR request数**  
    実運用値は未計測です。コード上はcache hit=0 request、非開催日=Meeting 1 requestだけ、既取得race=0 requestです。
20. **保存レース数**  
    実D1へ接続していないため0R（本番実測なし）。保存・重複skip経路は自動テストと既存D1テストで確認しています。
21. **旧方式比較**  
    30日×2場の旧候補は720R。新方式の実request数は開催日数・cache hit・実在R数に依存するため、本番計測前に削減率を断定しません。
22. **NAR通信**  
    `/api/nar/race`、`/api/nar/sync`、`/api/nar/odds`のrouteと通常処理は未変更。Worker内部の既存fetch/parserをHistoricalから再利用します。
23. **予想ロジック**  
    アプリのAI勝率・AI3着内率・TIME・期待値・穴馬・危険馬・波乱指数・Race Confidence・Prediction Consensusは未変更です。背景研究は別`9.9.34-background`のbacktest Snapshotとして隔離します。
24. **AI Data Bridge**  
    API仕様は未変更。既存Bridgeテストは全件成功しました。
25. **MCP**  
    6つのRead-Only tool仕様は未変更。既存MCP統合テストは成功しました。
26. **全テスト**  
    `npm run check`: 213 tests / pass 213 / fail 0。指定4ファイルの`node --check`も成功しました。
27. **PATCH ZIP**  
    `CHASS-KEIBA-LAB-Ver9.9.34-Cloud-Background-Historical-Collector-PATCH.zip`
28. **FULL ZIP**  
    `CHASS-KEIBA-LAB-Ver9.9.34-Cloud-Background-Historical-Collector-FULL.zip`

## 追加API

- `GET /api/db/historical-job`
- `POST /api/db/historical-job/start`
- `POST /api/db/historical-job/pause`
- `POST /api/db/historical-job/resume`
- `POST /api/db/historical-job/cancel`
- `POST /api/db/historical-job/reset`
- `POST /api/db/historical-job/meeting-cache/reset`

書込み操作は同一OriginかつJSONだけを許可し、任意SQL入力は受け付けません。AI BridgeのBearer tokenとは分離しています。

## デプロイ時の操作

1. `migrations/0002_background_historical_collector.sql`を本番D1へ適用。
2. Workerをdeploy。既存`*/5 * * * *` Cronは`wrangler.jsonc`に設定済みです。
3. アプリで有限期間Jobを開始。
4. Cloudflare logsで`[CHASS HISTORICAL BACKGROUND]`のJob ID、phase、processed、saved、elapsedMsを確認。
5. Safariを閉じ、15〜20分後に再表示してD1 Job進捗を実機確認。

GitHubへのpushおよびCloudflare本番deployは行っていません。
