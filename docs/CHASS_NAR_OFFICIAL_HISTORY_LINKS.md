# Phase136：NAR公式馬ID・過去レースIdentityリンク抽出

## 実測

2026-10-13、川崎1Rの通常版公式出馬表を結果前に読取専用で取得した。

https://www.keiba.go.jp/KeibaWeb/TodayRaceInfo/DebaTable?k_babaCode=21&k_raceDate=2026%2F10%2F13&k_raceNo=1

通常版は馬名リンクに`HorseMarkInfo?k_lineageLoginCode=...`、過去走リンクに`RaceMarkTable?k_raceDate=YYYY/MM/DD&k_babaCode=...&k_raceNo=...`を含んでいた。既存の省略版カードで得た馬番・馬名と照合し、12頭のprovider horse ID、過去レース参照31件を抽出した。

これは識別リンクの抽出実測であり、31件の過去レース内容取得・Rolling10・キャッシュ再利用・予測精度評価ではない。

## 実装するもの

`extractNarOfficialHistoryLinks(html, options)`は取得済み通常版HTMLを処理する独立モジュール。ネットワーク/D1/既存DATA/Packへの書込は行わない。

- source URLは公式www.keiba.go.jpのDebaTable、date/code/Rをexact-match。
- h4の現在Race Headerを使用し、ナビゲーションや過去走のレース表記で代用しない。
- Source observedAtは発走前でなければ拒否。
- 馬番・馬名をexpectedHorsesと照合し、全頭Coverageを要求。NFKC/空白正規化は比較だけに使用。
- 公式HorseMarkInfoリンクのprovider IDを抽出。名前だけ/今回馬番だけで恒久Identityを作らない。
- 過去レース日付はURLに実在するYYYY/MM/DDを使用。短い年表示やMM.DDから年度を推測しない。
- 過去レース参照は今回日より前だけ。同日で時刻が未確認の参照は安全に拒否。
- 観測されたNAR provider馬IDをNAR_LINEAGE namespaceへ保存。JRA等の別Provider Identityへ推測で変換しない。
- 非公式URL、重複Parameter、重複Runner/Provider ID、馬名不一致、リンク欠損、過去レース重複/5件超過、HTML1MB超過は拒否。
- 結果ページ/HorseMarkInfoはリンクを読むだけで取得しない。resultPageFetchCount=0。

Outputはsource URL/時刻/馬群/過去参照を持つhash付きresearch artifact。IDENTITY_LINKS_RESOLVEDはリンク抽出の状態であり、正式PredictionのIdentity Gate全体やFreezeのPASSではない。historyFactJoinStatus=NOT_PERFORMEDを保持する。過去リンク0件でも過去走が存在しないと断定しない。

## 今回の境界

既存Cronの軽量DebaTableSmall経路、日次対象場、件数/時間budget、能力/TIME式、D1 schema、Reader、Viewer、Pack V1/V2/V3は変更しない。既存HistoryのMM.DDをこのモジュールで遡及補完しない。

次の接続では、通常版取得を専用の件数/deadline制限内で追加し、カード観測と正式年月日付き過去リンクを一意照合する。同じ馬・同じEpisodeと証明できたものだけCanonical Historyへ接続する。現在のリンク順だけで異なる履歴SourceのFactを機械的にJOINしない。曖昧なものはHOLD。

共有履歴Store・Rolling10・差分更新・取得削減は次工程。通常版から市場値を能力DATAへ混入させない。今の正式EARLYや既存D1 revisionは不変。

## 検証

合成7件：正常抽出、現在Race/時刻、Runner/Provider重複、非公式/Parameter競合、future/同日/不正日付、過去リンクなし、サイズ/過去リンク重複。実カード12頭/31参照の抽出実測も行った。既存アプリへ接続した本番取得の実測は未実施。
