# 保存画像 → 09:00 JST → 日次研究結果 v1

対象base: 982da797c4fbea50c1175e44d4e9758d83aa8108。
実装は既定OFF。本書は実画像OCRの動作成功報告ではない。

## 今回接続する範囲

既存の5分Worker cronで09:00 JSTの回だけ画像入力を先に取得する。
画像の親フォルダから `NAR_指数画像_YYYY-MM-DD_競馬場` を探し、
該当会場のNAR公式RaceListにあるレースとPNGを突き合わせる。
全国全開催の発見・JRA・ばんえい・芝・横向き画像は対象外。
画像ファイルは `YYYY-MM-DD_競馬場_01R_タイム指数.png` から12Rまで。
リストのページングが残る、同会場フォルダや同レース画像が重複、画像欠落ならHOLD。

1. Driveの実バイトを読取り、取得前後のversion/modifiedTime等が同じことを確認。
2. Google Vision DOCUMENT_TEXT_DETECTIONを日本語ヒントで呼ぶ。
3. netkeiba NAR標準・縦長スマホの固定配置だけを読む。
4. 7列の見出し、馬番、行数、日付・会場・R、公式馬名、セルconfidenceを照合。
5. 別途取得した公式出馬表をProducerでも再取得し、11桁NAR IDを結び付ける。
6. 実際の処理時刻で新規Run/Input/IndexをProducerが作る。
7. 元OCRレスポンス、7列原値、Producer receipt、画像実バイトSHA・versionを
   独立したD1テーブルに保存し、実バイト読戻しと再検証を行う。
8. その後に日次分析を開始し、既存CPSI/Wave/研究レビューを実行する。
9. 前パッチのDrive保存アダプタへ接続し、アプリから確認する。

09:00は起動時刻。実際の取得・Freezeを09:00に書き換えない。
画像取得は210秒上限、日次計算の開始許容は従来の5分以内。
同時実行では画像取得中の別処理が空入力で日次ジョブを先取りしない。
一度取得した日付を自動再OCRしない。中断してRUNNINGが残った場合は運用確認が必要。
5分後のcronは新しいPREを作り直さず、Drive保存だけを再試行する。

## 値の意味

- 最高→peak、5走平均→baseline5、距離→distance、コース→course、前走→prev。
- 3走前・2走前を含む7列はrawRowsに保持する。
- `*`付き平均は原値を保持し、baseline5はnull。正式定義を推測しない。
- `-`、`未`はnull。0や他指数に置き換えない。
- 負数はそのまま数値として保持。currentは画像にないので常にnull。
- 名前・セルconfidence不足、未知記号はレース単位でHOLD。
- confidenceの0.98（数値）/0.90（名前）は実装上の受入閾値。
  98%/90%の正解率を検証したという意味ではない。
- 画像のオッズ・人気はPREDICTED_ODDS固定。発売実オッズとして使わない。
- 不足するクラスタ数、EV、展開、シナリオを数値から捏造しない。
- 6番人気以下は全対象馬を表示するが、根拠不足なら💎は付けずHOLD。
- 1番人気の校正済み信頼確率・警告シナリオは未実装/根拠不足のまま。
- Waveは利用可能な入力での研究値。欠損componentと不足理由を保持。
- RaceListの取消/除外等の変更が確認されたレースは自動採用せずHOLD。
  取消情報の網羅性や全馬の稼働状態を独立認証するものではない。
- 原画像の実バイトはDriveに残す。D1にはSHAとversion、OCR原応答を保存する。
  後日の元画像削除・改変を防ぐWORMストレージではない。

## 一度に確認する設定

既存の読取キー・サービスアカウントJSONを入れ直す必要はない。
サービスアカウントは画像の親フォルダを読める必要がある。
Google VisionはAPIの有効化・認証・課金設定が必要。未設定なら実行しない。
APIキーはVision APIに用途制限したものをWorkerのシークレットへ保存する。

| 名前 | 値・役割 |
|---|---|
| ENABLE_DAILY_ANALYSIS_V1 | true（日次計算。検証までOFF） |
| ENABLE_CPSI_DRIVE_READ | true（既存） |
| CHASS_CPSI_DRIVE_READER_TOKEN | 既存のアプリ読取キー |
| CHASS_CPSI_DRIVE_SERVICE_ACCOUNT_JSON | 既存の読取専用Google認証 |
| ENABLE_DAILY_IMAGE_INTAKE_V1 | true（実画像検証までOFF） |
| CHASS_DAILY_IMAGE_ROOT_FOLDER_ID | 画像の日付フォルダを格納する親ID |
| CHASS_DAILY_VISION_API_KEY | Vision API用キー。ブラウザやチャットに貼らない |
| ENABLE_DAILY_DRIVE_ARCHIVE_V1 | true（書込検証までOFF） |
| CHASS_DAILY_DRIVE_OUTPUT_FOLDER_ID | 日次JSONの保存先 |
| CHASS_DAILY_DRIVE_OAUTH_JSON | 前パッチの利用者OAuth。サービスアカウントをMy Driveの書込に流用しない |

今回確認できた構成例：

- 画像親: `1WWjruFmMmOfzJbROMGbudXLmTYKHAOsN`
- 10/23浦和: `1vB6Rk4wukFMAkby2_JWls4Dxi1J1DGJE`（12 PNG）
- 出力候補: `1Wo4DqUbG-oOTq__QHFm4U0czYQ-1KLtB`

本番反映時は通常のFinalize + Deploy経路で全件確認後、0016/0017/0018を適用する。
GitHub Pagesの成功だけでWorker反映を判断しない。
「接続設定を確認」は、日次機能がOFFでも既存の接続キーで使える。
`GET /api/chass/v1/research/daily/setup` は値を返さず設定の有無とSELECT結果だけを返す。
その成功はGoogle認証成功・画像精度確認・本番稼働成功を意味しない。

## 残る実データ検証

このパッチのローカル試験ではGoogle/NAR通信を模擬している。
実画像をGoogle Visionに渡し、全セルを原画像と照合した精度検証は未実施。
明朝9時の実行成功や正式PREは保証していない。
公式の発売実オッズ自動取得、シナリオ自動生成、校正済み信頼確率、
提供元の独立認証、正式KPI認定は依然このパッチの範囲外。
最初の実レースは研究限定で画像→公式ID→CPSI/Wave→D1→Drive→アプリを検証する。

公式仕様:
- https://docs.cloud.google.com/vision/docs/setup
- https://docs.cloud.google.com/vision/docs/reference/rest/v1/images/annotate
