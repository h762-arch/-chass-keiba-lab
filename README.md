# チャス競馬研究所 Ver.8.3

Ver.8.3 は「機能を増やす更新」ではなく、今後の更新を安全に続けやすくするための整理版です。

## 基本構成

今後は原則として次のファイルを中心に運用します。

- index.html
- styles.css
- app.js
- chass-latest.js
- worker.js
- manifest.webmanifest
- wrangler.jsonc
- package.json
- server.mjs
- README.md

予想データJSONなどは必要に応じて残してください。

## 今回の更新

- chass-latest.js の表示バージョンを Ver.8.3 に更新
- README を1本化する運用へ変更
- 過去の README-Ver*.txt / 旧パッチJSを増やさない方針に整理
- 今後の機能追加は原則 chass-latest.js に集約
- 既存の Ver.8.2 UI、現在オッズ、レース結果、検証導線は維持

## 導入方法

1. このZIPを展開
2. GitHubの `chass-latest.js` を同名ファイルで置換
3. `README.md` をこのREADME.mdで置換
4. Commit changes
5. Cloudflareのデプロイ成功を確認
6. Safariを再読み込み
7. 画面上部が `Ver.8.3` になれば反映完了

## index.html の推奨末尾

```html
<script src="app.js"></script>
<script src="chass-latest.js"></script>
</body>
</html>
```

現在すでにこの2本だけを読み込んでいる場合、index.htmlは変更不要です。

## 削除候補

以下は、現在の index.html / chass-loader.js / worker.js から参照されていないことを確認した後で削除できます。

- chass-v7.4-patch.js
- chass-v7.5-patch.js
- chass-v7.6-patch.js
- README-Ver7.4.txt
- README-Ver7.5.txt
- README-Ver7.6.txt
- README-Ver7.7.txt
- README-Ver7.8.txt
- README-Ver7.9.txt
- README-Ver8.1.txt
- README-Ver8.2.txt
- index-tail-Ver7.7.txt
- 追加手順.txt

## まだ削除しないもの

- app.js
- styles.css
- worker.js
- index.html
- chass-latest.js
- manifest.webmanifest
- wrangler.jsonc
- package.json
- server.mjs

`chass-loader.js` は index.html が読み込んでいる場合は残してください。
読み込んでいないことを確認できた場合のみ削除候補にできます。

## 重要

旧ファイルがGitHub上に存在しているだけなら、通常はアプリの動作速度へほぼ影響しません。
問題になるのは、index.html等から旧パッチを同時に読み込んでいる場合です。

削除は必ず「参照されていないこと」を確認してから行ってください。
