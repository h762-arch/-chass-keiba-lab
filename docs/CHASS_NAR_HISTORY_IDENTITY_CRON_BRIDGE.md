# Phase137：通常版カードIdentity取得・履歴観測との照合

## Cron接続

WorkerからNAR runnerへhistoryLinks callbackを渡す。ENABLE_NAR_HISTORY_LINKS=trueの場合、新規能力カードの取得・基本検証後に公式DebaTableを1回取得し、Phase136の全頭リンク抽出を実行する。結果ページ/HorseMarkInfoは取得しない。

通常版追加取得は1試行につき最大1回・最大2000ms・既存全体deadline/日次stopの残り時間以内。既存fetch helperの1MB/redirect禁止/ストリーム期限を使用。リトライなし。NAR試行3件、全体20000ms、JRA cap1/planning4、川崎のみ・10/14〜10/20・07:00〜14:55は保持する。取得OFFなら追加リクエストなし。

追加Source失敗・Provider未接続・照合失敗は安全なReason付きHOLDとして保存し、時間/発走前条件を満たす場合は通常能力DATAを保存する。deadline/発走時刻に到達した場合は保存自体を止める。Source原文の例外はAPIへ出さない。

## 履歴Factとの照合

リンクArtifact hash、現在Race、馬番・馬名、Provider Key、取得時刻を確認する。通常版取得時刻は省略版のSource取得以降・通常版headerの発走前を要求する。

各カード観測のCircuit=NAR・MM.DD・競馬場が、一つの公式過去Raceリンクと一意に一致した場合だけraceReferenceを追加する。同じ月日/競馬場の観測が複数ある場合や複数年度の候補が一致する場合はEPISODE_AMBIGUOUS。未一致やJRA過去走はEPISODE_LINK_UNMATCHEDで保持する。リンクの列順だけでFactを結合しない。

これは月日/場の一意照合による限定的なIdentity補強であり、過去走の全数値を別結果Sourceで再検証したという意味ではない。

## 不変性とSchema

元のカード観測Fact、dateText、canonicalDate=null、Fact hashは変更しない。History schemaVersion=2へoriginalHistoryHash、linksHash、リンク取得時刻、providerHorseKey、Observation別RESOLVED/HOLDの参照を追加し、新しいHistory hashを生成する。従来History V1も読取可能。

DATAは同じ新規snapshot内にhistoryLinksとhistoryLinkAuditを持つ。Audit RESOLVEDはカードの全頭Identity結合の成功を意味し、resolvedEpisodeCount/heldEpisodeCountを別々に保存する。全Episode解決やRolling10のREADYではない。

History V2のreadbackは元Historyとリンクの両hash lineageから再投影して照合する。Snapshot/Pack hashにも追加情報を含める。DATA calculatedAtは補強後の実時刻を使用し、Source acquiredAtは元カード取得時刻を保持する。Pack V3の既存構造で補強済みHistoryを保持する。

既存DATA/History/Original EARLYを遡及更新しない。既存レースはALREADY_SAVEDであり、Identity追加だけのために再取得しない。新規レースでLink HOLDのままDATA保存された場合、同revisionを後から修復せず、次の別の適格Source/Runへ回復を分離する。

## まだ行わないこと

共有History Store、Rolling10、跨レースのキャッシュ再利用、Historyによる能力/TIME再計算、CPSI/波乱度/印/Signal/正式KPIへの昇格は未接続。reuseStatus=HOLD / SHARED_HISTORY_CACHE_NOT_CONNECTEDを保持する。

今回以降の新規NAR日次試験では通常版追加取得が有効となる。Productionの実際のtimeout/保存throughputはマージ後の新規取得で測定する。2000msで常に取得できるとは主張しない。

## 検証

合成8件：元Fact保持、一意照合/曖昧保留、二重lineage検証、V1互換性、runner保存/API readback、Source失敗/OFF/Provider欠損、締切到達拒否、Worker/config接続。既存関連検証も実行。新規本番取得・全場展開・取得量削減は未実測。
