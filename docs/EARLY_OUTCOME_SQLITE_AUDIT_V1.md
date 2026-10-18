# EARLY outcome SQLite audit v1

## 目的

PR #258のJRA/NAR共通readerを、明示的なローカルSQLiteコピーから実行できるようにする。既存の予想・証拠・結果照合ロジックを再利用する。Node SQLite対応環境が必要。ブラウザ、Worker、server、cron、HTTPには接続しない。

基準main: `8fab6ea48df78dc6c8943a4fad380522a4b0f402`。

## 実行

対象レースをJSON配列で指定する。以下は形式例であり、実証拠の存在や適格性を示すものではない。

```json
[
  {"organization":"NAR","raceId":"2026-10-07|園田|7"},
  {"organization":"JRA","raceId":"20261004-JRA-東京-01"}
]
```

```bash
node scripts/audit-early-outcome-sqlite-v1.mjs \
  --evidence-db /absolute/path/evidence-copy.sqlite \
  --results-db /absolute/path/results-copy.sqlite \
  --targets /absolute/path/targets.json
```

3つのパスは全て明示必須。既定DB・探索・URL・接続資格情報・取得callbackは受け付けない。stdoutは集計JSONのみ。必要なら呼び出し側がファイルへ保存する。CLI自体はファイルを書かない。評価時刻はCLI実プロセス時計を開始時に1回固定し、`clockAuthority: LOCAL_PROCESS_CLOCK`とともに出力する。これはライブ取得のfreezeAtやEARLY Freezeではない。

モジュールAPIは `auditEarlyOutcomeSqliteV1(configJson)`。JSONには `evidenceDbPath`、`resultsDbPath`、`targets`、timezone付きISOの `evaluatedAt` を指定する。APIの時計は `CALLER_DECLARED_EVALUATION_TIME` と区別する。targetsは既存共通validatorで事前検査し、最大100レース。JSONは32KB以下、targetsファイルも32KB以下。PASS・認証済み等の追加入力は受け付けない。

## DBの役割

| 対象 | 証拠コピー | 結果コピー |
|---|---|---|
| JRA | precomputed_race_snapshots | jra_official_cache |
| NAR | research_nar_early_snapshots / research_nar_initial_bundles / research_nar_commit_observations | races |

指定した組織の表だけを要求する。同じパスを両方へ明示した場合も対応する。表は実テーブルである必要があり、既存契約の主キーまたは全行を対象にする同等のUNIQUE索引も必要。view、部分UNIQUE索引、キー欠落を許容して先頭行を勝手に選ばない。欠損表・列の生成やschema修復はしない。研究用表が本番D1にあるとは仮定しない。

DB内へのSELECTは既存readerからのみ発行。接続制御としてreadOnly、query_only、BEGIN、ROLLBACKを使う。証拠表と結果表はコード内の固定ルーティングで分離する。JRAのDATA/結果JSONはSQLiteからJSへ渡す前に各1MB以下に制限する。NAR原文の300KB/結果500KB制限は既存readerが保持する。超過はnullとなって既存の欠損/不正条件で保留され、補修しない。

## ファイル不変の確認

`research-sqlite-readonly-v1.mjs` にファイル検査を共通化し、従来のNAR SQLite証拠readerも同じguardを使う。

- 通常ファイルのみ。ファイル/親ディレクトリのsymlink、URL、制御文字を拒否。
- 1ファイル最大512MiB。SHA-256は64KiBずつ読み、全体をメモリに展開しない。
- rollback journal形式のSQLiteヘッダが必要。WAL/SHM/journal sidecarが存在したら保留。
- 開いたdescriptorのinode/size/mtime/ctimeとパスを照合。前後のSHA・stampを比較する。
- 開始時と終了時に変化があれば集計結果を破棄してHOLD。同一バイトの別inodeへの置換も保留。
- readOnly transactionを閉じる。書き込み・migration・保存・元データ補修は行わない。

この検査は観測したファイルの不変確認であり、取得元・独立時刻・過去の永続化の証明ではない。別DBの読み取りtransactionは単一の原子的snapshotではない。常に `crossDatabaseAtomicSnapshot: false`。活動中DBやWAL DBをこの入口のために変更せず、適切に作成された静止コピーを用意する。

## 出力と終了コード

返すのは共通readerの集計、評価時刻、対象配列hash、CLI対象ファイルの原文hash、両DBの全バイトSHAとサイズ、比較query数。パス・raw API・snapshot・sourceRef・RESULTの中身はstdoutへ出さない。従来のNAR証拠export CLIは従来契約どおり原文を返すため、今回の公開用集計CLIと区別する。

| exit | 意味 |
|---|---|
| 0 | READ_COMPLETE、全指定レースが保存行契約に一致 |
| 1 | READ_COMPLETE、PENDING/HOLDを含む不完全な比較 |
| 2 | 設定・ファイル・スキーマ・読取等の監査全体HOLD |

exit 0やREAD_COMPLETEはSmoke成功・真正な取得・正式KPI・Production承認を意味しない。結果未保存は敗戦として数えず、保留理由と件数を残す。JRA/NARは別々のレース平均。対象順を変えても比較内容は同じだが、入力hashは渡された配列順・CLIファイル原文をそれぞれ反映する。

全出力で sourceOriginAuthenticated / resultOriginAuthenticated / externalAnchorAuthenticated / trustedDurableTime / formalKpiEligible はfalse。Formal KPI HOLD / Probability MODEL_HOLD / Production Activation NO-GOを固定する。

## 検証と次の工程

テストは既存fixtureを共通化し、合成の元入力を既存builderで封印した後に、一時SQLiteファイルへ保存して実SQLを実行する。既存51件のNARテストも同じfixtureを使う。テスト用データを実取得の代わりに使わない。2DB/同一DB、JRA/NAR、部分結果、原文不変、sidecar、symlink、view、キー欠落、途中変更、CLI各exitと非公開情報の非出力を確認する。

実際の元証拠DBと結果DBのファイルはこの変更では指定・取得しておらず、実台帳照合は未実行。次に必要なのは、元bundle/receiptと同一race/modelの結果を保持する読み取り専用コピー、対象一覧、その来歴である。対象欠損や除外率の監査を済ませ、出典・永続化時刻の独立認証を検討してから未見レースのShadow比較へ進む。

NARのモデル別集計は `EARLY_MODEL_COHORT_BOUNDARY_V1.md` に従う。複数modelVersionの適格行があればNAR.metricsはnullとし、NAR.modelsに各モデルの値を分ける。対象レース群が異なるモデル同士の平均を、そのまま改善率や優劣へ流用しない。取消・DNF・同着の評価方針、独立認証、実台帳ログ比較、モデル改善の前向き評価は引き続き未完了。高知7Rの過去Smoke失敗も、この合成テストでは解消扱いにしない。

既存Production、Original EARLY、Signal Freeze、⚠️/💎、予想確率、TIME式、runtime flags、workflow、deployment設定を変更しない。
