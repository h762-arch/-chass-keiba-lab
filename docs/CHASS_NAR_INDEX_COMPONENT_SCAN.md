# Phase134：NAR Index Engine・列別記述的Scan

## 根拠と対象

Driveの「CHASS指数シート分析プロンプト v1.4 / v2.15 Evidence-Ledger Native」を読み、Source/Identity/Scale、欠損の中立性、Coverage-aware比較、隠れ閾値禁止、指数単独で最終決定しない原則を確認した。

https://docs.google.com/document/d/18Jop0xZhjRWzctfzb4LlilX9U5G0g1KELHAwgc28HE4/edit?usp=drivesdk

これは取得できた指数分析文書の参照であり、現在有効な全Provider/Cluster閾値Authorityが解決済みという宣言ではない。正式Prompt v2.20.11のIndex Source Priority/Index-First/fallback全工程や正式Evidence Ledgerの実装も完了していない。

対象は新規NAR公式カードから既存計算器が生成し保存した四つの構成値：timeIndex、fiveRaceAvgIndex、distanceIndex、courseIndex。各列を同じレース・同じ列・同じ計算版の範囲で比較する。Drive指数マスター、Peak、Current、CPSI、正式Index Providerとは区別する。これら四列を新たな単一Scoreへ合算しない。

## 計算と意味

- 各列に別Scale ID、HIGHER_IS_BETTER、NAR_ABILITY_PRECOMPUTE_V1、DERIVED_OFFICIAL_CARD_COMPONENTを保持。
- ACTIVEの有限数値だけを比較する。0は実在数値として有効、欠損はnullのまま。
- 競争順位：自分より値が大きい馬の数＋1。同点は同順位。
- Percentile：Comparable N>=2だけ100×(N−Rank)/(N−1)。同点のPercentileは同値。全馬同点なら全馬100になるが、全馬が強いという判定ではない。
- Top Deficit：同列最大値−自身値。Median Edge：自身値−同列中央値。
- 隣接差：降順・同値では馬番順に並べた前後との生の差。端の隣接差はnull。隣接差はClusterの分類ではない。
- Coverage分母は取消/除外/取止を除くRunner Universe。不明な出走状態はHOLDで、完全Coverageを偽装しない。
- 全有効馬が比較可能かつN>=2のみFULL_FIELD_RELATIVE。それ以外はKNOWN_ONLY_RELATIVE。
- N=1は順位/値を保持してPercentileはINSUFFICIENT。欠損理由・RecoveryActionを併記。

統計値はDESCRIPTIVE_RESEARCHであり、AI確率やEvidence Strengthへの加点、穴候補・印・Formal Signalへの昇格を行わない。同じ指数由来の値/順位/GapはINDEX_ABILITY相関Familyとして保持し、独立根拠数を水増ししない。

## Clusterと正本未接続の扱い

ClusterはAUTHORITY_UNRESOLVED / CLUSTER_RULE_NOT_RESOLVED。Gap+任意値等の閾値を作らない。MarketGapはEARLY input未接続を明示。INDEX_MASTERはNOT_CONNECTEDのまま。存在しないCurrent/Peakを四列から勝手に生成しない。

正本Providerの契約が揃えばIndex-First/History fallback、Native EARLY、Cluster/MG/CLへ段階的に接続する。指数だけでFinal5・◎・💎/⚠️を決めない。

## Pack保存と互換性

新規PackをCHASS_PRE_ANALYSIS_PACK_V2として作成し、indexAnalysisとINDEX_DERIVED_SCAN状態を追加する。Cronで通常の新規DATA保存へ含まれ、親snapshot hashとPack hashで保護される。新しいD1 schemaや日次設定変更は不要。

既存V1 PackはV1の生成契約で検証する。V1をV2へ遡及変換しない。Packがない旧DATAも引き続きNOT_MATERIALIZED。読取APIは保存済みPackを返す。Viewer表示、確率モデル、既存能力計算式、Formal KPI、Signal Freeze、既存revisionは変更しない。

## 検証と次段階

合成値の順位/Percentile/Top/Median/隣接差、同点、部分Coverage、1件のみ、取消、異なる列の分離、ゼロ値、V1/V2互換性・hash・不変性を検証する。既存のCron→保存→APIテストで新規V2保存も確認する。

本番V2保存は次の適格取得後に実測が必要。今の既存DATAを研究入力として書き換えない。次はRolling History/Source lineageと正本Index exact-match接続へ進む。Cluster Authority未解決を「Clusterなし」と解釈しない。
