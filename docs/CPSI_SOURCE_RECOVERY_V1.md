# CPSI元資料ライブラリ・不足回復 v1

基準main: e6e86d5b8752f1f140f8a8d95e9b0d5406805e51（PR #283）。
BOX APP-20261019-0100のうち、正規PRE元資料の再利用・不足回復・端末保存後の独立readbackを実装する。数式・Core適格性はPR #283の正本契約を利用する。

## 実装した経路

「予想入力 → CPSIを先に計算」に、元資料の端末保存、登録、出力、不足回復を追加した。

1. 正規PRE指数を既存の「指数JSONを読み込む」で読み込む。
2. 「元資料を端末に保存」で、正規指数と認可済みD–Gの入力だけを専用IndexedDBへ保存する。予想・結果のDBとは別の領域。
3. 保存transactionの完了後、別のread transactionで物理的に読み戻し、全体内容・件数・馬番/CanonicalHorseKey・SHA-256を検証する。一致した場合だけ「読戻一致」と表示する。
4. 次回同じ入力を読み込むと、同じ端末・同じサイトの登録元資料を自動検索する。「保存元資料から不足分を回復」でも再実行できる。
5. 資料が一致する場合、不足する生指数または既存の認可済みD–G成分だけを補い、CPSIを新規計算する。保存済みCPSI値・順位は計算に流用しない。

元資料は「元資料ファイルを出力」でJSONファイルにできる。「元資料ファイルを登録」で別端末や再設定後に取り込める。1ファイルで最大24レースを登録でき、全件の形式検査を終えてから保存を開始する。途中の保存失敗は、既に読戻確認できた件数も表示する。一括transactionではない。

## 厳密な照合

検索キーは組織JRA/NAR、Race ID、レース属性、Run ID、Input Snapshot、Index Snapshot、cutoff、post時刻、全馬番/CanonicalHorseKey/出走状態/eligibleの組。並び順は無視するが、欠けた馬・重複ID・取消状態の違いは一致としない。馬名や馬番だけの曖昧結合は行わない。

回復対象は同じSnapshot/Authority/取得時刻の不足値のみ。既知値、取得時刻、Authority、D–G成分に相違が1つでもあれば、その回復処理全体を中止して元の入力から計算した表示を保持する。複数資料の競合を読込順で解決しない。数値0や負の生指数も有効値として扱う。欠損は補正点や別の能力点に置き換えない。A＋C片側だけではCore不足のためCPSI【NA】のまま。

対象時刻は発走前のみ。読込時にも再度チェックするため、発走後に古いPREラベルを使って数値を再構築することはできない。結果や市場が正規指数に混在している入力は拒否する。通常の市場本文は保存対象へ投影せず、getterも読まない。

## 保存形式と容量

`CHASS_CPSI_SOURCE_V1` は正規化済み入力、SHA-256、検索キー、登録元の参照、登録時刻を持つ。`sourceOriginAuthenticated:false` を必須とし、物理readback成功と資料の出所認証を区別する。ハッシュは署名・出所認証ではない。登録元の参照ラベルも認証根拠ではない。

複数レースのファイル形式:

```json
{"format":"CHASS_CPSI_SOURCE_BUNDLE_V1","sources":["ここに既存の正規PRE入力オブジェクトまたは本機能の出力artifactを格納"]}
```

上記の文字列は説明用。実際の`sources`要素は既存の`CHASS_CPSI_PRE_INPUT_V1`（docs/CPSI_FIRST_V1.md参照）または`CHASS_CPSI_SOURCE_V1`オブジェクトである。本文を手作業で組み立てる代わりに画面の出力を利用できる。

JSONはUTF-8で2MiB以下、1ファイル24資料以下、1検索64資料以下、端末全体128資料以下。容量超過・IndexedDB利用不可・quota/transaction/readback失敗では成功表示を出さず、予想DBやクラウドを代替保存先にしない。既存入力ハッシュは不変で、同一内容の再登録は件数を増やさない。保存はブラウザの同一originに限られる。ブラウザデータ削除や別端末への自動同期はない。研究データの従来バックアップには含まれないため、元資料専用の出力を使う。

## 現時点で接続していないもの

これは端末ファイル/専用IndexedDBアダプターである。Google Drive/Sheetsの自動検索・Sheets列変換・Worker認証・D1元資料保存は未実装。ChatGPT側のDrive接続資格は本番Workerに引き継がれない。非公開資料を公開化する方法や、既存のread-only Bridge tokenを流用する方法は採用していない。

2026-10-20にアーカイブマスターの実ヘッダーと少数行を読み取り確認した。JRA/NAR指数マスターには最高指数・5走平均・距離・コース・前走・登録日時がある。一方、その表だけではRun ID/Input Snapshot/Index Snapshot/正規馬ID/独立した固定証跡が揃わない。NARのCPSI先行表は派生値を含み、CoreUsableが正本の現行扱いと異なる行もある。これらを自動で正規PREへ昇格させたり、不足IDや時刻を作ったりしない。次のDrive接続には、既存の正規Run/出走馬/固定manifestと読み取り専用の資格情報が別途必要。

保存元資料の端末readbackは実装・試験済みだが、実JRA/NAR資料の取得から本番アプリへの接続、出所認証、実iPhoneでの保存動作は未確認。このパッチだけでAPP-0100の自動Drive Source Recovery全体を完了とはしない。

参照:
- https://docs.google.com/document/d/1P2Z7WbovBH09C3TA6jhoSTiG8iw23B6JKoP45cXzURs/edit
- https://docs.google.com/document/d/1ACIlygzu-ibx6y6kMKCl3-Y-Vgr7KRZ-w2g1ZVK-seE/edit
- https://docs.google.com/spreadsheets/d/1dqFySEgG6cYEXIx8BmOw7tPOe7wI90H_No1FRoXlgoI/edit

## 検証・境界・復旧

純粋処理でJRA/NAR、0/負数、NA維持、同一単位の回復、競合時の全体中止、偽装・結果漏洩拒否、保存失敗/読戻相違、複数レース登録、切替中の遅延応答を確認する。実Chrome系ブラウザで320/390/430px、IndexedDB保存→ページ再読込→欠損入力の自動回復、オッズ取得0/POST0/予想未生成を確認する。

係数・確率・印・💎/⚠️・元EARLY・固定Signal・既存D1・56件の同期保留・cron・workflowは変更しない。Formal KPI HOLD / Probability MODEL_HOLD / Production activation NO-GOを維持。ロールバックは本パッチのrevert。専用IndexedDBには元資料だけが残るが、既存予想DBへの移行・転記は行われない。
