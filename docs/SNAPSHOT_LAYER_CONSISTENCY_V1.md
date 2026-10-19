# Snapshot layer consistency v1

基準main: `c03005ea33a7b4688426f7eeeea2b8058ba6b580`（PR #260）。

## 確認した不整合と修正

### 1. 読取表示の⚠️とmark alias

`frozenHorses`はFINALのmarkを表示用に結合してから凍結Signalを適用する。従来の排他処理はabilityMark/finalMark/valueMarkを空にしていたが、別名のmarkを残していた。このため凍結⚠️を復元した読取表示にmark ◎が残る経路があった。

共通 `enforceSignalMarkExclusion` でmarkも空にする。警告なしの正当な印は保持。legacy horsesのみの参考読取にもclone後の同じ排他を適用する。元Prediction/FINAL/凍結Signalやsealを変更せず、読取コピー上で⚠️との排他を守る。人気条件やシナリオを後から再判定してOriginal Signalを変更する処理ではない。

### 2. 旧Live builder起点の重複reader

`originalLayerHorses`はPrediction→Market→FINALを無制限にspreadしており、後続層にwin/place/TIME/馬名/features等があれば元予測値を置換できた。

同関数を既存 `frozenHorses` に統一する。Prediction所有の確率・能力・TIME・identityを保持し、既存allowlistの市場/表示値だけを結合し、Frozen Signalの印・空の根拠をそのまま使う。missing probabilityは後続層で埋めず、明示null市場値はnullを保持。原本ではなくcloneを返す。

通常の取消処理 `applyScratchStatuses` は現行どおりstatus-onlyであり、この旧 `buildLiveAdjustedPrediction` を自動実行しない。今回、builderを有効化したり新しい呼出経路を作ったりしない。ソースに残る旧helperの契約を統一する修正であり、本番で旧builderが実行されていた証拠ではない。

## 変更しないもの

予想式、AI確率式、TIME式、CPSI、⚠️/💎の条件、人気・シナリオ判定、Original EARLY、Signal Freeze、EARLY KPI保留、通常取消時の状態更新方針を変更しない。過去Snapshotの補修・再封印・後付け取得・保存・deploymentは行わない。Worker/server/公開asset allowlist/runtime flags/workflowにも変更しない。

app.jsのソースSHAは変わる。将来の別のLive smokeを行う場合、マージ後commitとappSourceSha256を改めて検証する必要がある。以前の高知7R smokeの再取得や成功扱いは行わない。

## 検証

副作用禁止のVMで実app.jsを読み、テスト内だけで旧helperを参照可能にする。productionのglobalやCHASS_TESTには新しいexportを足さない。

- 後続層の確率/能力/TIME/馬名/features混入が元予測を置換しない。
- 凍結⚠️とmark aliasの排他。凍結なし/警告なしの正当な印は保持。
- 原本JSON・seal不変、cloneの入れ子変更が原本へ届かない。
- Frozen Signalの空の印・空の根拠を、後続値で埋めない。
- legacy参考読取はSnapshotや確率を新設しない。
- 旧builderを直接単体実行した合成比較でも不正overlayの影響を受けない。
- 通常取消はstatus-onlyで、Live builderが新たに起動しない。

テストは合成データのみ。実ブラウザの視覚確認・実DB監査・本番稼働確認は別。ソース依存監査は実際の呼出/実行の証明ではない。

## 残る条件

PR #260のマージ・CI成功は確認済み。今回の修正が実データで発生頻度や精度を改善したとは未確認。元証拠/結果DBコピー・対象一覧・来歴が必要。独立出典・永続化時刻の認証、実台帳ログ比較、未見レースでの勝ち切り/Final5/CPSI比較は未完了。

Formal KPI HOLD / Probability MODEL_HOLD / Production Activation NO-GOを維持する。
