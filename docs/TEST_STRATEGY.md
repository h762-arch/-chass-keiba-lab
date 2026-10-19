# CHASS 段階別テスト運用

## 通常修正

- `npm test` / `npm run test:changed` / `npm run check:changed`: staged・unstaged・untrackedの差分を合わせて確認する。
- Bridge: `node scripts/run-affected-tests.mjs --staged`。未ステージの上書きがある場合は拒否する。
- Quick Change: `node scripts/run-affected-tests.mjs --working`。現行プリセットはwrangler設定変更なので、意図的に全件へ戻る。
- 変更JSの構文確認と、正確なファイル参照から求めた直接・間接の関連テストを実行する。同名別ファイルやコメントは関連の証拠にしない。Acorn 8.15.0を開発用に固定する。
- 削除・改名、設定・依存・ワークフロー・AGENTS・セレクター自身、HTML/CSS、15ファイル超、関連30テストファイル超、関連不明、非リテラルのモジュール読み込み、影響先の解析失敗は`npm run check`へ戻る。差分なしも空の成功にはせず全件を実行する。
- docs配下のmd/txtとREADME.mdだけの変更は実行時テストを省略する。
- `--plan`を末尾に付けると選択計画だけを出力する。これは検証成功ではない。

## PR最終確認

`npm run check`は従来の構文確認＋全件テストを維持する。`npm run test:full`も従来の全件テストである。Bridge/Quick Changeはdraft PRを作成し、修正段階の関連テスト成功を全件成功と記載しない。

PRをReady for reviewにすると`CHASS Full Integration Gate v1`が全件を実行する。非draft PRの追加更新でも再実行する。PRのheadとmainのbaseを記録し、その両方を含むmerge revisionを検証する。実行中にどちらかが変われば成功として採用しない。最新head/baseの全件成功を確認するまでマージしない。

手動再実行が必要なら同ワークフローのRun workflowにPR番号を入力する。mainだけをチェックする操作ではない。draft/closed PRやmain以外をbaseにするPRは拒否する。mainが更新され古くなった場合も再検証する。

権限は読取のみ。checkoutの認証情報を保持せず、依存のlifecycle scriptsも実行しない。ワークフローの起動・承認状況はGitHub画面で確認する。branch protection/rulesetの設定は今回変更しないため、自動マージ防止を保証するものではない。手動実行の成功は自動の必須チェックを代替すると扱わず、現在のPRのChecksとSHAを確認する。

## 本番反映

`finalize-deploy.yml`は変更しない。本番反映前の`npm run check`は必ず全件である。Original EARLY、確定Signal（印・💎・⚠️）、予測パラメータ、D1保存データは今回の変更対象にしない。

## 導入

この変更自体はワークフロー・依存の変更なので全件検証が必要。既存Bridgeは`.github/workflows/`を禁止するため、この導入パッチをBridgeに入れない。通常のGitHub PR経路で導入する。GitHubでの全件成功とマージを確認するまで運用変更済みとは記載しない。

検証結果はtargeted/full、対象ファイル、件数、base/head SHA、GitHub最終確認の状態を分けて報告する。GitHub Actionsの実行量とChatGPT Workの利用枠が同じ割合で減るとは主張しない。
