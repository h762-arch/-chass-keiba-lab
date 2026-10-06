# 2026-10-10 Original Signal 実データ検証手順

対象は JRA の保存済み Original Signal と保存済み公式結果の研究比較。
実データ検証日は 2026-10-10（日本時間）。実行例のレースIDは形式説明であり、開催・保存データの存在を示さない。
Production Activation は NO-GO。結果が良くても、この手順によって解除しない。

## 1. 発走前に保存する

アプリの研究バックアップを書き出し、元ファイルを `backup.json` として保管する。
形式は `CHASS_KEIBA_RESEARCH_BACKUP`、`schemaVersion: 1`。
対象レースの `races[レースID].marketSnapshot.signalSnapshot` が Original Signal の入力になる。
日付が `20261010` の保存済み JRA レースから対象IDを明示的に選ぶ（1〜100件、重複なし、01〜12R）。
レースIDの競馬場表記はバックアップとD1で一致させる。推測で修正しない。

- ⚠️は事前オッズありなら1〜3番人気、4着以下の具体的シナリオが必要。
- 💎は6番人気以下、2〜3着シナリオ・能力裏付け・市場評価が必要。
- 💎💎は6番人気以下、1着シナリオが必要。
- 💎💎💎は9番人気以下、1着シナリオと複数の強い裏付けが必要。
- ⚠️と◎○▲△☆・💎系は排他。後のオッズ・馬場・結果で保存済み印を変更しない。

この手順は印を生成しない。欠落した Freeze 情報を結果から補完しない。
バックアップはこのCLIでは32MiB以下。超える場合は実行を止め、原本を残して別途入力方法を検討する。

## 2. 保存済みキャッシュを読み出す

対象IDの転記を減らす場合は、先に読取計画をオフライン生成する。
`--race-ids` はバックアップに保存されている対象IDを明示する。自動選択・開催確認は行わない。

```bash
node scripts/plan-frozen-signal-export.mjs \
  --backup backup.json \
  --race-ids '20261010-JRA-東京-01' > export-plan.json
plan_exit=$?
printf 'export plan exit: %s\n' "$plan_exit"
```

終了0はSELECT文の生成成功のみ。D1接続・SELECT実行・結果取得・正式KPI承認を意味しない。
終了1は拒否で `queries: null`。対象ID・バックアップ・診断理由を確認する。
計画には原本のSHA-256、明示した全対象ID、結果キャッシュキー、既存ルール監査を記録する。
Signal欠落・provisional・ルール違反は診断に残し、対象を勝手に除かない。
レース同一性不一致、NAR、13R以上、曖昧な区切り文字・制御文字は拒否する。
ルール監査はシナリオ品質・発走前時刻・取得元の真正性を証明しない。

`queries.snapshots` / `queries.results` のSELECT文を既存の許可済み閲覧手段で使う。
ラベル内の引用符はSQL文字列としてエスケープする。実行前に対象・取得権限・行数を確認する。
最古の非空DATAを失わないよう、計画のスナップショットSELECTにはLIMITを付けない。
取得後は後述の上限・重複制約を満たすか確認し、超過行を推測で捨てない。
`export-plan.json` も原本と元SELECT出力と一緒に保存する。結果がまだない日は未取得のまま記録する。

既存の許可済みD1閲覧手段で、対象IDの行を SELECT のみで取得する。
以下のプレースホルダーはバックアップで確認した実在の対象ID・競馬場に置き換える。
この手順のための INSERT / UPDATE / DELETE、migration、deploy、フラグ変更は行わない。
EARLY DATA が未保存でも、新規計算・後付け保存で穴埋めせず、欠落として記録する。

```sql
SELECT organization,race_id,revision,source_validated_at,
       data_calculated_at,calculated_at,calculation_version,
       model_version,status,data_json
FROM precomputed_race_snapshots
WHERE organization='JRA'
  AND race_id IN ('<対象レースID>')
  AND calculation_version='jra-ability-data-v2'
  AND model_version='10.0.1-jra-drive1-ability'
  AND data_json IS NOT NULL AND data_json<>''
ORDER BY race_id,revision ASC;
```

```sql
SELECT organization,race_date,track,race_no,payload_json,fetched_at
FROM jra_official_cache
WHERE kind='result'
  AND cache_key IN ('result|2026-10-10|<競馬場>|<整数レース番号>');
```

複数レースでは IN に全対象を列挙する。最古の非空DATA行を必ず残す。
最古行が不正でも、後の正常行に置き換えない。結果が未保存ならその行は存在しないままでよい。
元のSELECT出力も保存し、行の取得元・取得日時・対象IDを別記録に残す。
`data_json` と `payload_json` はJSON文字列のまま、時刻は元の値のまま保持する。
公式由来でないデータの `source` を `JRA_OFFICIAL` に変えない。

取得した行配列を以下の形式で `cache.json` にまとめる。
これは空の構造例であり、実データではない。
D1ツールの外側の `results` 等ではなく、行オブジェクトの配列を入れる。

```json
{
  "schemaVersion": "CHASS-JRA-SIGNAL-CACHE-1",
  "snapshotRows": [],
  "resultRows": []
}
```

上限はファイル32MiB、snapshotRows 1000行、resultRows 100行。
スナップショットの同一 race_id / revision / calculation_version / model_version は重複禁止。
結果の同一 race_date / track / race_no も重複禁止。異なる内容の重複は採用行を推測せず調査する。

## 3. オフライン実行する

リポジトリのルートで実行する。依存ライブラリの追加インストールは不要。
`--race-ids` と `--now` は実際の対象ID・検証時刻に置き換える。
`--now` はタイムゾーンを含むISO日時で、入力行の最新時刻以降の検証時刻を記録する。
以下の時刻は例であり、全レースの結果が揃う時刻を意味しない。

```bash
node scripts/compare-frozen-signals.mjs \
  --backup backup.json \
  --cache cache.json \
  --race-ids '20261010-JRA-東京-01' \
  --now '2026-10-10T18:00:00+09:00' > comparison.json
comparison_exit=$?
printf 'comparison exit: %s\n' "$comparison_exit"
```

入力ファイルは読み取り専用。`comparison.json` はシェルの出力リダイレクトで新規保存する。
再実行時は別ファイル名にして、前回の出力・入力を保持する。

| 終了コード | 意味 | 次の行動 |
| --- | --- | --- |
| 0 | 観測馬があり、レース・馬の除外がない研究比較 | 集計と入力の由来を確認する。正式KPIやActivationの許可ではない |
| 1 | 入力拒否または読み取り不能 | status / reason を確認し、原本を残して入力・読取経路を調査する |
| 2 | 除外がある、または観測馬が0 | 除外理由・未取得件数を記録する。未取得を不的中にしない |

## 4. 結果を読む

`status: READY` でも観測が完全とは限らない。終了コードと summary を併せて見る。
`readerExclusions`、`summary.excludedRaces`、`summary.excludedHorses` に理由を記録する。
EARLY DATA がない場合は `EARLY_DATA_NOT_FOUND`。結果がない場合は `OFFICIAL_RESULT_NOT_FOUND`。
最古DATA不正は `EARLY_MALFORMED_DATA` 等となり、後のDATAには進まない。
発走時刻・Freeze時刻・公式結果の取得時刻を検証できないレースは除外される。

| 印 | scenarioHits の条件 | 率の分母 |
| --- | --- | --- |
| 💎 | 2着または3着（1着は別の winHits に計上） | その印の observedHorseCount |
| 💎💎 / 💎💎💎 | 1着 | 各印の observedHorseCount |
| ⚠️（強度を統合） | 3着以内に入らない | ⚠️群の observedHorseCount |

`scenarioHitRate`、`winHitRate`、`top3HitRate` は馬単位。レース数を分母にしない。
分母0の率は null。除外・未取得は分母に含めない。
この実装の判定は着順比較であり、シナリオの質・回収率・ROIを評価しない。
⚠️の観測も対応する結果行が確認できた馬だけを対象とする。

## 5. 検証記録と保留判断

比較JSONの保存後、元の入力ファイルと照合して再検証する。

```bash
node scripts/verify-frozen-signal-comparison.mjs \
  --backup backup.json \
  --cache cache.json \
  --comparison comparison.json > verification.json
verification_exit=$?
printf 'verification exit: %s\n' "$verification_exit"
```

比較CLIは `CHASS-SIGNAL-COMPARISON-1`、検証時刻 `evaluationNow`、対象ID `requestedRaceIds` を記録する。
検証CLIは同じ時刻・IDで再計算し、SHA-256と全比較出力を照合する。
終了0 / VERIFIED はローカル入力からの再現性のみ。未取得を含む比較でも再現できれば VERIFIED になる。
`comparisonExitCode` が元の比較の完全性（0または2）を示す。終了1なら reason を記録して調査する。
旧形式でメタデータのない比較JSONは拒否する。原本を保管し、新形式で別ファイルに比較を再実行する。
JSONのキー順・空白だけの変更は許容するが、入力ファイルのバイト変更は検出する。
入力と出力を一緒に作り直した場合の真正性や、対象の選び方・検証時刻の妥当性を保証する機能ではない。
verification.json も検証記録に残す。VERIFIED によって正式KPI採用やNO-GO解除は行わない。

読みやすいMarkdownレポートを作る場合は次を実行する。内部で同じ再検証を行い、照合済みの再計算結果だけを使う。

```bash
node scripts/report-frozen-signals.mjs \
  --backup backup.json \
  --cache cache.json \
  --comparison comparison.json > report.md
report_exit=$?
printf 'report exit: %s\n' "$report_exit"
```

終了0は観測あり・除外なし、2は再現可能だが未取得・除外ありまたは観測なし。
終了1は拒否で、レポート本文は出力しない（シェルが作る report.md は空）。stderr のJSON理由を確認する。
レポートは観測数と的中数を併記し、未観測を0%と表示しない。割合は小数点以下2桁に丸める。
report.md も原本・比較JSON・検証JSONと一緒に保存する。少数標本からProductionへの有効性を断定しない。

保存するもの：発走前バックアップ原本、元SELECT出力、cache.json、実行コマンドと終了コード、comparison.json。
出力の `backupSha256` / `cacheSha256` は入力バイトの同一性確認用。取得元の真正性の証明ではない。
`inputProvenance: LOCAL_FILES_NOT_AUTHENTICATED` を保持する。
`predictionStage: SIGNAL_FREEZE` は Original Signal の研究比較であり、正式EARLY印との同一性を証明しない。
`formalKpiEligible: false`、`productionActivationReady: false`、`scenarioQuality: NOT_EVALUATED` を報告に残す。
保存されたEARLY・Freeze・公式結果が不足していれば「検証未完了」として理由と件数を報告する。
Production実測、正式KPI採用、シナリオ品質評価、Activation承認は、この手順とは別に確認が必要。

実装参照：
[CLI](../scripts/compare-frozen-signals.mjs)、
[EARLY読取](../src/prediction/jra-early-research-reader.mjs)、
[研究比較](../src/research/jra-signal-outcomes.mjs)、
[集計](../src/research/jra-signal-outcome-summary.mjs)。
