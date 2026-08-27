チャス競馬研究所 Ver.7.4 パッチ

【目的】
- NAR対応競馬場を 船橋・笠松・園田・姫路・門別 に拡張
- 同一 workers.dev 上の /api を自動利用
- Worker URLの手入力を不要化
- 画面の Ver.7.1 表示を Ver.7.4 に更新
- 同一Worker接続が確認できた場合、旧「NAR自動連携設定」を非表示

【導入方法】
1. このZIPを展開
2. chass-v7.4-patch.js をGitHubリポジトリ直下にアップロード
3. index.html の </body> の直前に次の1行を追加
   <script src="/chass-v7.4-patch.js"></script>
4. worker.js は現在のVer.7.3のままでOK
5. Commit changes
6. Cloudflareの新しいデプロイが緑✓になるまで待つ
7. アプリを再読み込み

【確認】
- /api/health が version 7.3
- アプリ表示が Ver.7.4
- NAR自動連携設定のURL入力欄が消える
- 園田等のレースで「NAR公式取得」が動く

※このパッチは現在の app.js を大きく差し替えず、安全に追加する方式です。
