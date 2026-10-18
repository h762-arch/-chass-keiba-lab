# NAR EARLY outcome evidence reader v1

## 目的と適用範囲

PR #257の共通EARLY集計入口に、NARの保存済み初期bundle・commit observation receipt・確定結果を照合する内部研究readerを接続する。予想・確率・印を生成しない。既存のNAR証拠検証器を再利用する。

基準main: `55e144c3e7837ac34a1543dd884a03e51e460693`。この文書はPR #257文書のNAR未接続状態を、今回の変更範囲について更新する。

## 境界

`readNarEarlyOutcome({DB,raceId,now})` は明示的に渡された `prepare(sql).bind(...).first()` adapterを使うNode専用・SELECT専用入口。browser、Worker、server、HTTP、cronへの接続はない。実DBの指定・取得・migration・自動作成もしない。研究用bundle/receiptテーブルが本番D1に存在するとは仮定しない。別DBから渡すadapterも呼び出し側が明示的に構成する必要があり、この変更では未実装。

既存の原文を読む順番:

1. `research_nar_early_snapshots`: legacy名前空間が存在したら別途監査が必要としてHOLD。後続bundleに代替しない。
2. `research_nar_initial_bundles`: 指定レースの原文、最大300KB。
3. `research_nar_commit_observations`: 同一レース・同一bundle content SHAに結び付く原文、最大300KB。
4. 既存 `auditNarInitialEvidenceV1` に原文とUTF-8 SHAを渡す。既存の内容・意味・観測時刻検証が全て一致した場合だけ進む。
5. `races`: EARLYに明記されたmodelVersionとraceIdが一致する元の `result_json`、最大500KB。既存の結果再構築機能や別モデルへのfallbackは使わない。

原文の補修・再封印・再取得・historical replay・保存は行わない。保存時の意味検証で既存verifierが純粋な再計算をすることはあるが、新しい予想・EARLYを保存する処理ではない。

## 照合条件

NAR会場・実在日付・レース番号、初期revisionの既存契約、取得/封印/観測時刻、発走前の観測、未来時刻でないことを確認。modelVersion欠損はAPP_VERSION等で埋めない。予測の全馬に数値0〜100のwin/placeが必要。place < winも除外する。

結果は既存自動保存形式schemaVersion 3、同一raceId、organization NAR、resultSource NAR_OFFICIALが必要。この文字列は出典の真正性の証明ではない。結果のfetchedAtと保存行のresult_acquired_atが等しく、予定発走および観測より後、評価時刻以下でなければHOLD。

全頭の馬番・正規化馬名を照合する。全頭の1〜Nの順位が一意で、上位3頭とfinishOrderが一致する必要がある。取消・除外・中止・同着・欠落・不明順位は通常の敗戦にせずHOLD。TIMEの馬番や二重表現が矛盾すればHOLD。欠損/解釈不能なTIMEはサンプルから除き、件数を明示し、0秒で埋めない。確率そのものは変更しない。

## 出力と集計

成功時 `status: READY` / `rowContractQualified: true` は保存内容の照合だけを意味する。返すのはレース/モデル識別子、bundle/receipt内容SHA・原文SHA・結果原文SHA、観測区分、頭数、Brier、TIME MAE。raw API・snapshot・sourceRef・RESULTの中身・馬ごとの結果は出力しない。

結果未保存はPENDING。その他の不整合は理由付きHOLD。共通集計は未確定もheldRaceCountに含め、requested = contractQualified + heldを維持する。JRAとNARは別集計。各レース平均を同じ重みで平均し、馬数の多いレースへ勝手に重み付けしない。TIMEなしレースはTIME平均の分母から除く。対象なし/適格なしのNAR metricsはnull。

全出力で `sourceOriginAuthenticated=false`。NAR readerはさらに `resultOriginAuthenticated=false`、`externalAnchorAuthenticated=false`、`trustedDurableTime=false`。内容SHAが一致しても、取得元・時計・DB永続化時刻を独立認証できたことにはしない。呼び出し側のPASS/trueフラグで昇格しない。

Formal KPI HOLD / Probability MODEL_HOLD / Production Activation NO-GOを固定する。

## 検証と未完了

専用テストは合成の元入力を既存capture/receipt builderで最初から作る。実取得失敗を合成データで救済するものではない。SQLiteのquery_only接続でも実SQLを確認する。失敗・改ざん・時系列・別モデル・別馬・取消・同着・欠損・入力不変・共通入口・runtime非接続を検証する。

実際の証拠DB/結果DBは読んでいない。実データ件数・性能改善・本番動作・独立出典認証・真正な永続化時刻・配信経路・実台帳のログ比較監査は未確認。過去の高知7R smoke失敗も未解消。この変更は予想精度向上の証明ではなく、前向き比較を安全に行うための内部経路。

次の工程は、元原文を保持した証拠DBと結果DBの読み取り専用接続を用意して欠損率/除外理由を確認し、その後に独立時刻・出典認証と公開用の集計契約を設計する。そこが整ってから未見レースのShadow比較で勝ち切り評価・Final5除外監査・CPSI欠損影響を検証する。Production昇格や予想ルール変更は別の判断。
