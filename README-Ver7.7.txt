CHASS KEIBA LAB Ver.7.7 改善パック

【今回の改善】
・CHASS FINALを最優先表示
・市場データ未取得時はMARKET CHECKを非表示
・市場取得時も、乖離候補・注意馬中心のコンパクト表示
・各馬の詳細分析は初期状態で閉じる
・重複していた旧MARKET VALUEカードは自動で非表示
・Ver.7.7表記へ更新
・今後index.htmlを毎回編集しなくてよいローダー方式を導入

【一度だけ行う変更】
index.htmlの末尾を次の2行だけにします。

<script src="app.js"></script>
<script src="/chass-loader.js"></script>

その下に </body></html> を置きます。

【アップロードするファイル】
1. chass-loader.js
2. chass-latest.js

既存の以下3ファイルは残してください。
・chass-v7.4-patch.js
・chass-v7.5-patch.js
・chass-v7.6-patch.js

【今後】
Ver.7.8以降は基本的に chass-latest.js を差し替えるだけで、
index.htmlへのscript追加作業は不要です。

【確認ポイント】
1. ヘッダーが Ver.7.7
2. 市場未取得時に MARKET CHECK が出ない
3. 実オッズ取得後に MARKET CHECK が表示される
4. 各馬詳細が最初は閉じている
5. CHASS FINALがレース概要の直後に表示される