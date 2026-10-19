# App consistency batch v1

基準main: `e656c0c471b4549f360b086e1b1b001d72af8554`（PR #261）。同PRのCI 3310/3310 PASSを実ログで確認。

## 今回まとめた修正

| 領域 | 確認した問題 | 修正後 |
|---|---|---|
| クラウド結合 | 異なるモデルでも、空の結果/市場/FINAL層を補完できた | モデル不一致はCLOUD_MODEL_MISMATCHで隔離 |
| レースと層の帰属 | 外側の保存キー、record、各Snapshotの帰属を一貫して検査していなかった | 明示的なレース/組織/モデル不一致を隔離 |
| 原本の独立性 | 競合returnでlocalを浅くコピーし、hydrateの削除処理が元raceへ届き得た | 結合前に両入力をclone、補完層もclone |
| Signal | 共通readerの後に、pending Signalまで再度適用できた | 二重適用を削除。frozenは全Signal、warningFrozenAtのみは警告だけ |
| 復元値 | 保存済みhorsesの後続確率/特徴が、元Predictionと食い違う余地 | 保存画面/クラウドとも同じstatus-aware読取コピー |
| 取消状態 | クラウドhydrateで状態が抜け、空オッズ等を結果参加と扱う余地 | 状態は別に復元。appとWorkerの保存用整形で空/0/bool/object/空白結果を参加証拠にしない |
| 確定結果/検証 | 同じレースでも別モデルの結果を受け入れ、検証層が無効でも完了flagが残る | 明示モデル不一致を拒否。無効な結果/検証とflagsを復元コピー上で解除 |
| 監査と件数 | 競合理由を一律化し、取り込まなかったレコードも追加件数に数える余地 | 理由を保持、競合をeligible IDsから除外、追加/補完/保留を実取込・ユニークrace単位で区別 |

## クラウド競合

既存 `mergeCloudResearchRecord` を境界に使い、別の予想readerや取得経路を追加しない。モデルはPrediction.modelVersionを優先する既存方針。既知レースがある場合、Prediction/Market/FINAL/Result/Validationの明示identityとモデルを検査する。

隔離理由は CLOUD_RACE_MISMATCH / CLOUD_MODEL_MISMATCH / CLOUD_LAYER_BINDING_MISMATCH / CLOUD_RECORD_MISSING / DUPLICATE_OR_CONFLICT。元localがあればその原本を保持したコピーに競合flagを付け、cloudEligibleをfalseにする。元localがない不正な配送はキャッシュへ挿入しない。競合理由を監査へ残し、既存競合を後続配送だけで自動解除しない。

同じrace/model・同一Predictionの正当な結果補完は維持する。既存Prediction/Market/FINALは上書きせず、sealの移管も全凍結層が一致する既存条件を保持する。元入力のraceに格納されたsealを取り出す際も、元オブジェクトを変更しない。

## 復元と取消の表示

`restoredHorseView` は既存frozenHorsesのコピーを使い、確率・TIME・馬名・特徴・凍結Signalを保護する。保存済み可変horsesの確率を代用しない。

状態だけを、整合した結果の参加情報、確認済みscratch audit、明示active、保存済み状態の順に反映する。低確信の除外はunknownとし、確認済み取消にしない。結果も明示race/modelが違えば取消解除に使わない。表示用復元ではscratch auditのtimeline・原本・sealを更新せず、Live再計算もしない。

結果参加を補う市場値は正の有限数か、その数値文字列のみ。null、空、空白、0、boolean、array、objectは不採用。time/actualTime/cornerPositionsは空白だけでは証拠にしない。空actualTimesキーも参加にしない。既存の正当な着順・TIME・正のオッズによる参加、公式activeによる状態復旧は維持する。status labelがなくても正当な結果参加証拠は扱う。Prediction外の馬番のstatus itemは無視する。

Workerの保存用整形でも、同じ空値判定と明示race/model不一致の除外を適用する。正当な参加による状態復旧は維持。Workerは既存のread/serialization契約を使い、表・route・書込手順は増やさない。

これは取得元の独立認証ではなく、既存の結果契約を厳密化したもの。通常取消は引き続きstatus-only。旧Live builderを有効化しない。

## 結果と完了flag

layerMatchesActiveは従来のrace/organizationに加え、明示されたmodelVersionを確認する。不明な明示organizationを現在レースへ読み替えない。modelラベルが元から欠けるlegacy層へ新しいラベルや認証を付けない。

restoreSavedRaceで不正結果は結果・検証・actualTimesを復元コピーから外し、無効検証はvalidationSnapshotとvalidationCompleted/validatedを外す。元保存データを補修する処理ではない。暗黙identityのlegacyは従来互換を維持するが、正式な出典・時刻認証とはしない。

## 画面と件数

サーバーの保存件数を、端末結合後の適格件数と混同しないようラベルを明記する。競合保留R数と日本語の理由を表示する。サーバー返却counts自体を端末の件数で書き換えない。

復元追加/補完はキャッシュに実在し競合しないraceを1回ずつ数える。結果待ちの正当な予想レコードは追加対象として維持する。取り込めなかったraceや競合は追加成功として数えない。復元完了表示にも競合保留件数を付ける。

## 検証と限界

副作用禁止VMで実app.jsを使う合成テスト。別race/model、各層不一致、深いclone、pending/frozen/warning-only、復元状態、モデル不一致結果、null/空白/0/bool等、参加あり/なし、監査・件数を検証。既存の保存・Signal・取消・JRA・Snapshot回帰も実行する。

既存の取得や保存手順を増やさない。実DB・実ブラウザの視覚確認・本番の配送や書き込みは実行していない。コード中の既存復元操作はキャッシュを保存するが、今回その実操作は行わない。実台帳の欠損率・発生頻度・精度改善は未確認。

予想式/AI確率/TIME/CPSI、⚠️/💎の人気・シナリオ条件、Original EARLY/Signal Freeze、runtime flags、server、workflow、deployment設定は変更しない。app.jsとworker.jsのソースは変更するがdeployはしない。将来の別Live smokeはcommit/source SHAを再検証する。高知7Rの再取得・補修・合成代替・解消扱いはしない。

次に必要なのは元証拠/対応結果SQLiteコピー・対象一覧・来歴。実台帳ログ比較、独立出典/永続化時刻認証、未見レースの◎勝ち切り・Final5/CPSI比較は未完了。整合性の全保証や予想精度の向上を、この合成テストだけで断定しない。

WorkerのAI公開用 `bridgeOriginalHorses` には別のMarket結合readerが残り、今回そこは未統一。Prediction所有値の上書き可否と凍結Signalの扱いは次の具体的な監査対象。今回のWorker修正範囲は結果参加による取消状態の整形に限る。

Formal KPI HOLD / Probability MODEL_HOLD / Production Activation NO-GOを維持。
