チャス競馬研究所 Ver.7.6 完全統合版

【構成】
- index.html
- app.js          Ver.7.4 / 7.5 / 7.6 機能を統合済み
- styles.css
- manifest.webmanifest
- worker.js       NAR公式連携 API Ver.7.3
- wrangler.jsonc

【重要】
index.html から読み込むJavaScriptは app.js だけです。
今後、chass-v7.4-patch.js / chass-v7.5-patch.js / chass-v7.6-patch.js を
個別に追加する必要はありません。

【GitHubへの更新】
この6ファイルをリポジトリ直下へアップロードし、同名ファイルを置き換えてください。
その後Cloudflareのデプロイ完了を確認してください。

【主なVer.7.6統合内容】
- AIフェアオッズ / 実オッズ / 期待回収率を分離
- 実オッズ確認時のみ期待回収率を確定表示
- レース単位の市場スナップショット保存
- 初回市場 / 最終市場の保存
- CHASS FINAL
- モデル別トップ評価の保存・検証
- 穴馬 / 人気馬リスク / 回収率の検証
- モバイル向けダッシュボード表表示
- NAR同一Worker API連携
