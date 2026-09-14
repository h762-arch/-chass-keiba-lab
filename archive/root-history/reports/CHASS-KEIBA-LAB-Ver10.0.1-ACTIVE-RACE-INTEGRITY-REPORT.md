# CHASS KEIBA LAB Ver.10.0.1

## Active Race State Isolation & Validation Integrity Report

実施日: 2026-09-07

## 結果

- 改修前基準: 275 / 275 PASS
- 改修後: 285 / 285 PASS
- failure: 0
- 予想ロジック、JRA 12,000回Simulation、Calibration係数、TIME、TOTAL、EV、💎、⚠️は変更していません。
- Scratchはstatus-only仕様を維持し、Live Adjusted Predictionを再生成しません。

## 根本原因

1. `setRaceMode()`で空のモード別stateを作成した直後、`render()`が非表示の共通フォームに残った旧NAR値を`state.race`へ再代入していました。
2. Result取得の古い応答判定がraceIdだけを比較し、organizationと画面世代を確認していませんでした。
3. Resultフォーム復元時のリセット対象に、実走時天候・実走時馬場・Actual TIMEが含まれていない経路がありました。
4. Public API URLが確定済みActive Raceではなくフォーム値を参照していました。

## 変更ファイル

- `app.js`
- `styles.css`
- `README.md`
- `tests/active-race-integrity.test.mjs`（新規）

## 変更関数

- `activeRaceIdentity`
- `snapshotIdentity`
- `layerMatchesActive`
- `activeRaceContext`
- `beginActiveRaceTransition`
- `activeRequestMatches`
- `restoreSavedRace`
- `clearValidationTransient`
- `render`
- `renderResultDiagnostics`
- `renderScratchLayer`
- `displayHorses`
- `currentLongshotScenario`
- `makeSnapshot`
- `setRaceMode`
- `loadJraFile`
- `commitJraNormalized`
- `commitAutoRaceData`
- `syncNar`
- `performResultFetch`
- `saveFetchedResult`
- `applyAutoFetchedResult`
- `currentPublicApiUrl`
- `checkPublicApi`
- race/date/track/mode input handlers

## State Isolation

表示可否の基準を`organization + raceId`の完全一致にしました。JRA/NAR切替またはraceId変更時には画面世代を進め、表示用Prediction、Market、Final、Result、Validation、Scratch、診断、一時フォーム値を外します。D1、IndexedDB、保存済みSnapshotは削除しません。

JRA入力フォームだけが存在し、Prediction Snapshotが未作成の場合は「JRA データ待ち」またはフォーム上の競馬場・Rと「予想データ未読込」を表示します。旧NAR Predictionは利用しません。

## Validation Reset / Restore

Active Race変更時に以下をリセットします。

- 1〜3着
- 実走時天候
- 実走時馬場
- Actual TIME
- 検証メモ
- Result診断
- Result/Validation一時状態

復元は保存レコードのorganizationとraceIdがActive Raceへ一致する場合だけ許可します。識別子を持たない旧データは、既存のレコード単位復元テストを維持するため互換読取のみ残しました。

## Snapshot Identity

新規Prediction、Market、Final、Result、Validation Snapshotへ`raceId`と`organization`を保存します。既存Prediction Snapshotは書き換えず、fingerprint固定を維持します。

## Stale Async Response Guard

Result要求開始時に以下を固定します。

- `raceId`
- `organization`
- `activeRaceGeneration`

応答時に3項目がActive Raceと一致する場合だけ現在UIへ反映します。別レースへ移動済みの場合、取得元レースの処理と現在画面の描画を分離し、旧応答で新画面を汚染しません。

## Public API UI

- 「現在レースAPI URL」は確定済みActive Predictionのrace/date/track/organizationから生成します。
- Prediction未読込時はURLを生成しません。
- 接続確認成功時に最終確認時刻を表示します。

## UI微修正

- 馬詳細のTIME値をnowrapとし、375〜430pxで極端な縦割れが起きにくい文字サイズへ調整しました。
- READMEの旧Scratch Live Adjustment節へ履歴仕様であることを明記しました。

## 追加テスト

`tests/active-race-integrity.test.mjs`へ10件追加しました。

1. NAR川崎9RからJRA切替で旧Predictionを除去
2. race変更でActual TIMEとValidation一時値を除去
3. 別organization/raceIdのResultをActive扱いしない
4. JRAフォーム入力のみではPrediction未確定
5. 一致するJRA PredictionだけをActive化
6. JRAからNAR切替で旧Validationを除去
7. 保存Result復元はorganization/raceId完全一致
8. 画面世代変更後の非同期応答をstale判定
9. Public API URLがActive Race一致
10. 全表示層Invariantがorganization/raceId双方を検査

## Full Check

```text
tests 285
pass 285
fail 0
```

`node --check`対象の全JS/MJSファイルも成功しています。

## 既存機能への影響

- JRA 12,000回Simulation: 変更なし
- JRA Calibration / Validation: 計算式変更なし
- NAR Prediction / parser / transport URL: 変更なし
- Result Recovery: 取得方式変更なし。現在画面への反映条件のみ強化
- Auto Result Queue: 優先度・取得方式変更なし
- Historical Collector / Similarity: 変更なし
- Public Read-Only API / AI Data Bridge / MCP: endpoint・schema変更なし
- Google Drive / Airtable Sync: 変更なし
- Scratch: runnerStatus-onlyを維持

## Known Issues / 実機確認

- 自動テストと構文検査は完了しています。
- 実iPhone Safari端末そのものはこの環境から操作できないため、375/390/393/430pxの実機タップ・復帰テストは未実施です。CSSの対象幅と状態Invariantはテスト・コードで確認しています。
- 旧SnapshotでraceId/organizationフィールドがないものは、Prediction Snapshot内のraceまたは保存レコードのraceから識別します。識別不能な旧データは互換読取対象ですが、新UIの別レース混在には使用しません。

## Rollback

PATCH ZIPに含まれる4ファイルを改修前へ戻すことで局所Rollbackできます。D1 migrationや既存データ変更はありません。
