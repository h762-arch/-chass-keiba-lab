# Drive接続の端末保持 v1

初回に既存のDrive接続キーを入力し「この端末で接続を保持（30日）」を押す。
同じ本番URL・ブラウザでは、再読込やブラウザ再起動後もCookieが残れば再入力不要。
キー入力だけなら従来のメモリ内利用も継続できる。保持は明示操作時のみ。
「接続を解除」でそのブラウザのCookieと画面内キーを解除する。
別ブラウザ・別URL・期限切れ・Cookie削除・プライベートモード終了後は再接続が必要。

## 実装

- 同一originのPOSTでBearerを検証し、原キーを含まないHMAC署名Cookieを発行。
- __Host- / Secure / HttpOnly / SameSite=Strict / Path=/ / Max-Age=2592000。
- 署名はorigin・発行時刻・期限・乱数に結合。期限は延長せず最長30日。
- POST後にCookieだけのGETで保持を確認してから成功表示。
- 認証はCPSI元資料と日次研究の既存読取APIだけ。Google秘密鍵の入力や新規D1保存不要。
- 既存読取キー変更は全セッションを無効化。ログアウトは当該ブラウザのCookie削除であり、盗まれたCookieを個別失効するサーバー台帳は設けない。
- クロスorigin・same-site別originを拒否。状態変更はOrigin一致必須。原キーやCookieをURL・localStorage・IndexedDB・予想バックアップへ保存しない。
- ブラウザで共有PC等を使う場合は作業後に解除する。
- Original EARLY / Formal Signal / 本番D1 / cron有効化は変更しない。

併せて既にCloudflare画面で登録した画像親・出力フォルダIDをwrangler.jsoncのvarsへ同期。
keep_varsによる全変数の保持や、Googleキー・OAuth秘密値のリポジトリ保存は行わない。
Google Vision/OAuth設定・OCR実データ精度・正式PRE認定は未完了のまま。

ローカル試験は合成データ。GitHub統合テスト・本番ブラウザによる保持は適用後に確認。
