# Phase135：NARカード履歴保持・Rolling History準備基盤

## 確認した制約

現在のWorker `parseRuns`は公式出馬表内の最大5走を解析し、過去走日付をMM.DDとして返す。恒久馬ID・過去レースID・年度はこの経路で確定していない。馬名だけ/今回馬番だけ/MM.DDだけで別レースの履歴へ結合しない。

## この変更

新規NAR事前計算の各馬に、最大5走のカード観測をhistoryとして保存する。既存DATA revision、能力計算、TIME式、日次/Cron上限は保持する。Sourceの追加取得は行わず、同じ公式カードpayloadに既にあるrunsを使用する。

保持項目：日付原文、競馬場、過去走のCircuit、距離、馬場、方向、着順、頭数、TIME秒、上がり、通過順位。過去走Circuitは実際の観測値として保持し、今回NARレースのCircuitへ勝手に置換しない。

過去人気/オッズは能力DATAへコピーしない。今回条件に依存するscore/sameDistance等も履歴Primitiveとしてコピーせず、既存指数Evidenceとは分ける。missingはnull/空配列で保持し、値を生成しない。

各観測にRace ID×今回馬番×card観測順のObservation Key、Fact hashを付ける。全体にSource=公式カード、親Race Source参照、取得時刻、History hashを保持する。これは恒久的Horse/Episode IDではない。

同じFact hashでも、年度・Race ID未確定なので同一Episodeとは断定しない。2つの観測を無条件にdedupしない。parsedCount/retainedCount/capacityを保存し、最大5観測をRolling10取得済みとは表示しない。

## 状態と再利用

- runs配列あり：RETAINED。空配列でも『解析観測0件』であり、『過去走が存在しない』とは断定しない。
- runs配列なし：SOURCE_NOT_RETAINED。0件取得成功と区別する。
- 年度はYEAR_UNRESOLVED、canonicalDate=null。
- globalHorseIdentity=null、reuseStatus=HOLD。
- Reason=CANONICAL_HORSE_AND_EPISODE_ID_UNRESOLVED、Recovery=恒久馬IdentityとEpisode年月日をSourceから確定してから横断mergeする。
- 十走CoverageはNOT_CONFIRMED。

親snapshotのIdentity/取得前時点に基づくカード観測として保持するが、正式History Availability TerminalやForward eligibilityをここだけで宣言しない。現在レースのRESULTを取得したり、履歴を結果後に補完したりしない。

## Pack互換性とAPI

新規PackはCHASS_PRE_ANALYSIS_PACK_V3。historyPacksとCARD_HISTORY_RETENTIONのPARTIAL状態を追加し、ROLLING_HISTORYは引き続きNOT_CONNECTED。V1/V2はそれぞれの生成契約で検証し、historyPacksを遡及追加しない。既存PackなしDATAも読取可能。

新規historyはDATAとPack双方のhashに含まれる。APIは親Race/馬番/取得時刻、History hash、各Observation Key/Fact hashを確認して返す。追加D1テーブルやschema migration、Viewer表示変更はない。

## 続くRolling History接続

1. 公式の恒久馬IDと、年度を含む過去レースIDを取得・照合する。
2. Canonical Horse/Episodeキー付き履歴Storeを用意する。
3. Source Snapshot/取得時点/対象cutoffを保持し、同Episodeの訂正を新revisionとして管理する。
4. 既存Episodeを再利用し、新規/不足Episodeだけ追加取得する。最大10走のCoverageとHistoryDepthGapを明示する。
5. 既存Original EARLYは不変、新しい適格Runから最新の履歴投影を使用する。

このパッチだけでは別レース間キャッシュ、Rolling10、再取得の削減は完成しない。これらの必要識別情報を保留したまま既存Source観測が失われないようにする基盤である。

## 検証

合成データで履歴Primitive/出典保持、5件制限、同Fact観測の保持、未取得/解析0件の区別、tamper/identity/時刻拒否、V1/V2/V3互換性、Cron保存→API readback、追加Source呼出しなしを検証する。本番V3/history保存は次の新規取得後に実測が必要。
