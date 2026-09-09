# CHASS KEIBA LAB 10.0.1 — JRA J1 変更ファイル限定パッチ

作成日: 2026-09-09 JST

## 今回の範囲と状態

J1（公式開催予定の取得、日付→競馬場→R選択）までの実装候補です。
J2の出馬表・自動予想、J3のオッズ、J4の結果取得は未実装です。
既存のJSON/CSV/手動入力とJRA予想モデルを引き続き使用します。
実機確認前のため、本番検証済み・全自動化完成とは扱わないでください。

基準ソース: ユーザー提供 `-chass-keiba-lab-main.zip`。
ZIP記録commit: `000726ce27188ef92ab638617e04c7c8cd3c7817`。
追加提供の10ファイルは、このZIP内の対応ファイルと同一でした。
以前のfalse-exclusion-fixed ZIPへ戻す変更は含みません。

## iPhoneからGitHubへ反映する手順

1. このZIPを「ファイル」アプリで展開してください。
2. GitHubリポジトリの最上位（app.js、worker.jsがある場所）を開きます。
3. Add file → Upload files で、展開した中身のファイルをすべて選択します。
4. ZIPそのものや、展開フォルダごとを入れず、中身を最上位へ配置してCommitします。
5. 通常のCloudflareへの反映手順でWorkerと画面の両方を更新してください。
   GitHubへ保存しただけでCloudflareに反映されるかは、現在の連携設定次第です。
6. アプリを再読み込みし「中央競馬」を選び、開催日を2026-09-12にします。
7. 公式取得に成功した場合、中山・阪神の開催予定と各1〜12Rが選択対象です。
   その他の場は「開催予定なし」と表示されます。
8. 「JSON・CSV／手動入力で予想する」を開くと、全10場を手動選択できます。
   従来のデータファイルを読み込み、従来どおり予想を計算できます。

今回、GitHubやCloudflareへのアップロード・デプロイは実行していません。
D1マイグレーション、Secret追加、GitHub Pages設定変更は不要です。

## 変更ファイルと主な関数

| ファイル | 変更 |
|---|---|
| app.js | setRaceMode / fillRace / fillJraRace と初期化にJ1接続。既存のレース切替処理を再利用 |
| index.html | 開催選択、再確認ボタン、状態表示、手動入力折りたたみ、J1スクリプト読込 |
| styles.css | JRA選択欄の狭幅レイアウト |
| worker.js | GET/HEAD /api/jra/meeting の分岐と共有モジュールimport |
| server.mjs | ローカルサーバーにも同一APIの分岐 |
| package.json | test:jra-j1 と既存テストコマンドへのJ1テスト追加 |
| jra-meeting-discovery.mjs | sourceUrl / parseJraProgram / createJraMeetingService / handleJraMeetingRequest |
| jra-meeting-selector.js | create / refresh / manual / setActive、画面の古い応答を破棄 |
| jra-program-fixture.html | 公式ページDOMから開催選択に必要な部分を抜粋したfixture |
| jra-j1.test.mjs | J1の18テスト |
| PATCH_README_JRA_J1.md | この説明書 |
| JRA_J1_SHA256.json | ZIP同梱ファイルのSHA-256（このmanifest自身を除く） |

ファイルはすべて最上位へ置く構成です。新しいフォルダ作成は不要です。

## API・公式情報・Quality Gate

API: `GET /api/jra/meeting?date=2026-09-12`（HEADにも対応）。
日付単位で10場を返します。任意URLを受け取るAPIではありません。
source = JRA_OFFICIAL、parserVersion = jra-program-v1、scheduleOnly = true。

公式情報源:
https://www.jra.go.jp/keiba/calendar2026/2026/9/0912.html

この公式ページは開催「予定」の番組表です。開催実施・出走馬の確定情報ではありません。
non_meetingは「解析できた予定表に当該場がない」という意味です。
臨時変更・中止の完全な判定には利用しません。手動選択で上書きできます。

日付見出し、番組表caption、レース番号の意味的見出し、行見出し、
競馬場の重複・未知名、馬番ではなくR番号の重複・範囲、HTML終端などを検査します。
構造不整合時にレース番号を推定生成しません。
fixtureはブラウザDOMの抜粋であり、HTTP生HTMLではありません。

404・通信失敗・timeout・構造変更はunknownです。非開催へ変換しません。
UIではloading/meeting/non_meeting/unknown相当の状態を表示します。
取得失敗時も全場・1〜12Rの手動選択と従来入力を利用できます。
保存済み予想を開く操作、NARへの切替、日付変更、手動入力への切替後の古い応答は適用しません。
このAPIから予想・オッズ・結果・D1書込みは行いません。

## 負荷とキャッシュ

- 公式取得は日別番組表1ページのみ。全12Rの出馬表・過去走を取得しません。
- 同一日付の同時リクエストはsingle-flight。キャッシュキーはJRA:日付でNARと分離。
- 新鮮な同一日付を10回取得するテストでは、外部fetchは初回1回、残り9回は0回。
- 今日・未来の予定は20分、過去は24時間、失敗結果は60秒のメモリキャッシュ。
- これはWorkerインスタンス／Nodeプロセス内キャッシュです。
  D1永続キャッシュ・複数Worker間共有・IndexedDBキャッシュはJ1では追加していません。
- 最大128件、異なる日付の同時取得は最大4件。8秒timeout、本文512KiB上限。
- 構造エラーが連続3回発生すると、新規公式取得を5分休止します。
- 再確認ボタンでもキャッシュを無視した公式連打はしません。
- リダイレクトを追跡せず、Cookie・認証・外部proxy・アクセス制限の回避を行いません。

## Feature Flags

Workerの環境変数、またはNodeの環境変数で
`ENABLE_JRA_MEETING_DISCOVERY=false` とすると公式取得を停止します。
未設定時はtrueです。OFFはキャッシュの内容より優先します。
画面側もapp.jsより前に `window.CHASS_FEATURES={ENABLE_JRA_MEETING_DISCOVERY:false}`
を設定すれば、開催予定APIを呼ばずに手動選択できます。

以下3つはモジュール内の予約済み既定値falseです。
J1ではONに設定しても対応する自動取得機能は存在しません。
ENABLE_JRA_AUTO_FETCH / ENABLE_JRA_ODDS_FETCH / ENABLE_JRA_RESULT_FETCH。

## 互換性と検証結果

Node v24.19.0で確認。
`npm run test:jra-j1`: 18件成功、0件失敗。
公式DOM解析、異常構造、unknown、timeout、キャッシュ、single-flight、
停止flag、circuit breaker、Worker分岐、画面状態・古い応答破棄を検証しました。
ローカルNode APIの実HTTP GET/HEADはflag OFFで200、外部取得なしを確認しました。

提出ZIPの元ソースはテスト関連ファイルが最上位へ平坦化されています。
そのままの `npm run check` は既存の `mcp/bridge-client.mjs` 不在で停止しました。
検証用コピーに限り、同梱の既存テストをtests/、fixtureをtests/fixtures/、
SQLをmigrations/、同梱bridge-client/chass-toolsをmcp/へ復元して比較しました。
この検証用復元ファイル群は今回のパッチには含めていません。

| 同一検証用配置での比較 | 総数 | 成功 | 失敗 |
|---|---:|---:|---:|
| 改修前 | 322 | 317 | 5 |
| J1追加後 | 340 | 335 | 5 |

新しい失敗は0件です。ただしFull Check全成功という意味ではありません。
検証用配置でも `npm run check` は既存のmcp/server.mjs不在で停止します。
回帰比較は `node --test regression.test.mjs tests/*.test.mjs jra-j1.test.mjs` を別途実行しました。

残る5失敗は改修前と同じです:
1. google-drive-production: research-storage-sync.mjsのdailyArchive export不在。
2. connector source: mcp/server.mjs等の不在。
3. MCP server declares: mcp/server.mjs不在。
4. mcp-live-integration: MCP SDK依存ファイル不在。
5. migration is additive: .gitignore不在。

JRA Normalizer・Adapter・Model、D1 schema、Research Storage、MCP関連モジュール、
NAR Meeting Discoveryは基準ソースとバイト単位で同一です。
Public API・AI Bridgeの処理内容は変更していません。
NARの既存自動処理や市場分離ロジックも変更していません。
MCP/Driveの本番正常性は、上記既存欠落があるため今回の検証だけでは保証できません。

## 未確認と次の段階

- Cloudflare本番からJRAへの実際のGETと、生HTMLを使ったエンドツーエンド動作は未確認。
- ローカル画面は検証用ブラウザから接続を拒否され、375/390/393/430pxの描画確認は未完了。
  CSS対応は実装していますが、iPhone実機で表示・選択・手動入力の確認が必要です。
- 別日・別開催場・将来のHTML変更への実証はまだ限定的です。
- 本番で取得に失敗した場合はunknown表示を確認し、手動入力を継続してください。
- J1の実機確認と報告後の承認を経て、J2（出馬表Parser・既存Normalizer接続）へ進みます。

## 戻し方

開催取得だけを止める場合は上記flagをfalseにしてください。
画面を含めて完全に戻す場合は、基準ZIPのapp.js/index.html/styles.css/worker.js/
server.mjs/package.jsonを戻します。D1データの変更・削除は不要です。
