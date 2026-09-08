# CHASS KEIBA LAB Ver.10.0.1 — False Exclusion Current Status v2

## 確認できた根本原因

`worker.js` と `server.mjs` の `parseRaceCard()`、および `worker.js` の単複オッズ解析が、馬の行全体 `row.text` を `horseStatusFromText()` に渡していた。

出馬表行には過去走情報も含まれるため、過去走欄の「出走取消」「競走除外」「取止」を今回レースの状態として誤認できる構造だった。

## 修正内容

- 行全体による現在状態判定を廃止
- 専用の「変更情報／変更区分／状態」列または明示的な変更セルだけを判定
- 専用変更情報がなければ通常出走馬を `active` とする
- 単複オッズとrunnerStatusを分離
- `server.mjs`もWorkerと同じ判定規則へ統一
- NAR RaceListの当日変更情報を `changes` として抽出
- 変更情報を `date + track + raceNo + horseNo` で限定
- Meeting Calendarの既存JSON列に後方互換形式で変更情報を保存
- 現在出馬表のactive情報で古い誤除外をreconcile後、当日変更情報だけを適用
- Result参加馬をactiveへ戻す既存Safety Netを維持
- Original Prediction Snapshotおよび能力・確率・TIME・印は変更なし

## 再現テスト

現在馬：12番 ミストラ

現在変更情報：なし

過去走：2026/07/06 川崎8R 出走取消・疾病

結果：`horseStatus = active`、`eligible = true`

専用の今回変更欄に明示した場合のみ、`scratched` / `excluded` / `withdrawn` となることも確認した。

## 検証結果

- 対象テスト：24/24合格
- 全回帰テスト：317/317合格
- 構文検査：合格

## 未確認

本番デプロイおよび本番NAR HTMLを用いた2026/09/09川崎4R・12番ミストラのHTTP確認は、この環境では実施できていない。デプロイ後に再取得し、UI・Public API・保存済みscratchAuditの修復結果を確認すること。
