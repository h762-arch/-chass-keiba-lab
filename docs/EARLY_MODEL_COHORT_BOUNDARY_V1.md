# EARLY model cohort boundary v1

基準main: `0d4b5c5ab937e037f6e551dfde789b9d4b30162d`（PR #259）。

## 問題と変更

従来はNARの各race/model結合が一致していても、異なるmodelVersionを同じNAR平均へ加えていた。CLI文書では別実行を求めていたが、コードでは混在を防いでいなかった。

今回、共通 `summarizeEarlyEvidenceCohort` 内で適格NAR行を正確なmodelVersionごとに分離する。出力とreportに `modelBoundaryVersion: CHASS_EARLY_MODEL_COHORT_BOUNDARY_V1` を付け、従来のcohort versionとは区別する。SQLite/CLIにもreport内の識別子が渡る。追加のSELECT・取得・予想再計算はない。JRAは既存の固定calculation/model version readerを保持する。

| NARの適格モデル数 | NAR.metrics | NAR.models | modelScope |
|---|---|---|---|
| 0 | null | 空配列 | NO_QUALIFIED_MODEL |
| 1 | 従来と同じそのモデルの平均 | 1要素 | SINGLE_MODEL_VERSION |
| 2以上 | null | 各モデルの件数・平均 | MULTIPLE_MODEL_VERSIONS_SEPARATED |

複数モデルなら `mixedModelAggregateWithheld: true`。単一/適格なしはfalse。models配列は版文字列のコード単位順。前後空白等を除去して別モデルを勝手に同一視しない。object keyではなくMap/配列で管理する。

同一モデルでは各レース平均を等重みで平均し、頭数の多いレースを重くしない。TIME欠損はそのモデルのTIME分母から除き、0秒で補完しない。件数は matchedRunnerCount / timeSampleCount / timeRaceCount を明示する。

PENDING/HOLDはモデル平均やモデル適格件数へ入れず、既存excluded/reasonCountsへ残す。requested = contractQualified + heldは維持。複数モデルがあるだけで適格行を不適格へ変更しない。モデル間の優劣や改善率は自動判定しない。

## 互換性

適格モデル0〜1件のNAR.metricsは従来互換。複数モデル時は意図してnullへ変更するため、数値を読む側はnullを扱い、モデル別は `report.NAR.models[].metrics` を使う必要がある。単一全体平均を前提にした利用は止める。

既存SQLiteモジュール/API/CLIは共通readerを使うため、今回の区分がそのまま出る。CLI exit 0は全レースの保存行契約一致だけを示す。複数モデルで混合平均がnullでも、全行契約が一致すればexit 0でよい。正式KPI、認証、モデル採用の成功ではない。

各モデルの明細でも formalKpiEligible/sourceOriginAuthenticated はfalse、formalKpiReadiness HOLD、Probability MODEL_HOLD、Production NO-GOを明示する。外側の認証/永続化時刻の保留方針は変更しない。

## 検証

合成元入力を既存NAR builderで最初から封印する共通fixtureを拡張し、モデル・レース番号・頭数をテスト前に指定できるようにする。保存原文の補修ではない。単一版・混在版・同版複数R・頭数差・TIME欠損・未確定・空版・版名の完全一致・順序不変・入力不変・SQL/CLIを検証する。

基準のモデルA/B合成例ではwin Brierが0.08/0.005。従来の混合平均0.0425を表示せず、それぞれの値を分けて返す。これは検出動作のテストであり実モデルの優劣の証拠ではない。

## 未完了と次の強化

実台帳コピーは未指定・未読。ファイル名検索で確認できたSQLite候補だけでは実台帳と認定せず、合成テスト用を実取得の代用にしない。元bundle/receipt・対応結果コピー・対象一覧・来歴が必要。

実データの欠損/除外を監査し、独立出典・時刻認証を検討したうえで、同一モデル/同一レース群の前向き比較へ進む。◎勝ち切り/3着以内、Final5除外、CPSI欠損影響は次の研究課題。保存が3頭しかない場合にFinal5を後付けせず、欠損として区別する。100R等の件数だけで採用/正式昇格しない。

予想式・AI確率・TIME・⚠️/💎・Original EARLY・Signal Freeze・runtime wiring・保存・deployment設定は変更しない。元の高知7R取得エラー解消やログ比較監査完了を主張しない。
