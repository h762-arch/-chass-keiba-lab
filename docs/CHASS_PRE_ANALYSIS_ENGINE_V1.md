# Phase133：CHASS Pre-Analysis Engine v1 / NAR材料Pack基盤

## 分業と同期の範囲

アプリは取得・計算・構造化・全馬材料の保持・品質監査を担当し、チャスは今回の展開、比較、反証、具体的Win/Top3 Route、Portfolio、印、Formal Signalの意思決定を担当する。材料があることと、全馬Discoveryや正式予想が完了したことを分ける。

必要な同期はAnalysis Packの入力/出力契約、計算版、Source/Authority参照、解釈側の対応Schemaである。全文Promptの自動同期は前処理の実装の前提ではない。表現変更は既存Packを利用できるが、新たな必須Fieldや意味の変更は契約更新・互換性確認を必要とする。全文同期/Authority公開/Capability自動検知はこのパッチに含まない。

設計参照として確認した正式プロンプトはv2.20.11：
https://docs.google.com/document/d/1F9dg2evScjsyIk96yvFv-ES_eMhMpvol29LtATV8qsE/edit?usp=drivesdk

アプリのPackは正式Runtime Boot、Derived Bundle、FinalPortfolio、Role/Win物理Artifactを代替しない。最新Promptの全工程準拠を宣言しない。添付💎/⚠️ルールのシナリオ→能力→市場→Signal、印との排他、Original immutableを保持する。

## このパッチで実装する範囲

NAR事前能力計算の新規保存時に、同じSOURCE/DATAから`CHASS_PRE_ANALYSIS_PACK_V1`を生成し、既存DATA内へ保存する。新しいD1テーブルやschema migrationは不要。全出走馬をRace ID×馬番で一意化し、能力点/順位、TIME、保存根拠、欠損理由、RecoveryActionをまとめる。

- Pack statusはPARTIAL、researchOnly=true、formalKpiEligible=false。
- 能力点はNAR公式カードからの派生値。Drive指数正本やCPSIとは明示的に区別する。
- 全馬材料を保持するが、reviewedRunnerCount=0、discoveryComplete=false。候補抽出/保護/維持を実行済みと表示しない。
- 各馬のDecisionはNOT_DECIDED。印、正式Signal、Win/Place Role、確率調整を自動決定しない。
- 未接続のIndex Master、Rolling History、Context、CPSI、Position/Pace、Pressure、EARLY Market、Favorite、Bottom4、全頭Longshot Retriever、Retention、Wave、Boundary、Role/Win、Formal ReadinessをNOT_CONNECTED＋Reason＋Recoveryへ着地させる。これらはSourceが存在しないという判定ではない。
- hashは入力馬群のFact hashとPack hash。親snapshotのhashにもPackが含まれる。

読取APIは保存済みPackを返し、親Race/馬群/取得時刻・Pack内容を照合する。検証のための期待投影の再構成は同じ保存Factから行い、Source再取得や予想再分析はしない。

旧DATAへPackを遡及追加しない。旧データは従来どおり読め、Pack=null / NOT_MATERIALIZED。新規runのPARTIAL Packと区別する。既存immutable revisionを保持する。日次設定、場、Cron、件数上限、時間budgetは変更しない。

## チャスへの受渡し

NAR `/day`・`/day-ai`・`/race`のrace payloadにpreAnalysisPackとpreAnalysisStatusを追加する。status監査にはpreAnalysisStatus/PackHashを追加。Viewerの表示は変更しない。

チャスはPackのcontractVersion、race identity、hash、source time、coverage、PARTIAL項目を先に確認する。PackにあるFactは出典付きで再利用し、重要な欠損・比較境界だけ追加取得する。Packに存在しないScenarioやSignalを保存済みとして提示しない。正式Prompt本文そのものはこのパッチで更新しない。

## 続く実装

1. Index Availabilityと正本/scale/version接続。Rank/Percentile/Gap/Clusterは実在する同尺度値だけから計算。
2. HorseHistoryPack：rolling10、差分更新、Episode/SourceRef/鮮度・Coverage。非新馬のHistory取得履歴と不足理由を保持。
3. 同一EARLY市場のFavoriteとBottom4、全頭Longshot材料監査。Bottom4だけを穴候補母集団にしない。Formal💎/⚠️を材料監査で発行しない。
4. TIME比較、Position/Pace、Pressure、共通Scenario、CPSI InlineとNAR専用Wave。
5. 全頭Retriever/RetentionとProtected材料。Best Excludedは比較対象のprovisional Portfolioが定まった後の派生結果として生成し、比較前に捏造しない。
6. チャス側Decision Artifactの保存/readback、正式ReadinessとOriginal EARLY Freeze。

AI確率はモデル版・校正状態を持つ再現可能な値として扱う。手動の最終調整を行う設計を追加する場合も、調整前後・根拠・モデル契約を保持し、未校正研究値をFormal値へ言い換えない。

## 検証と限界

合成データで全馬保持、UNKNOWN neutrality、非最終Decision、hash/identity、深いコピー、取消馬保持、新規D1保存/API readback、旧DATA保持を検証する。本番での新規Pack保存はマージ・deploy後の適格取得で確認が必要。13モジュール全部の実装や分析時間短縮率を主張しない。

作成時baseにはPhase132のパッチは含まれておらず、本パッチの依存でもない。本パッチは作成時のmainをbaseにしている。別PRのマージでmainが進んだ場合はBridge前にbase/適用チェックを更新する。
