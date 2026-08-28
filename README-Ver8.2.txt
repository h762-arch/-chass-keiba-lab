チャス競馬研究所 Ver.8.2 UI更新

【今回の改善】
- 予想データファイル選択ボタンを上部へ追加
- 「現在オッズ」「レース結果」「検証を見る」をまとめて操作可能
- QUICK VIEWの文字重なりを修正
- 全馬比較をスマホ向けカード型に再構成
- AI勝率 / 複勝率 / TIME / 総合を崩れにくく表示
- 実オッズ取得済みなら現在オッズ・人気・期待回収率も全馬比較へ反映
- レース後検証を独立表示のまま維持
- 既存のraceImportFile / fetchOfficialNar / fetchOfficialResult / dashboardViewを再利用
- Ver.8.1の解析ロジック・保存データ構造は変更しない

【導入方法】
1. ZIPを展開
2. GitHubリポジトリの chass-latest.js を、この chass-latest.js で置き換える
3. Commit changes
4. Cloudflareのデプロイ完了を待つ
5. Safariで再読み込み

index.html がすでに
  <script src="app.js"></script>
  <script src="chass-latest.js"></script>
の構成なら、index.htmlの追加編集は不要です。

【重要】
app.js / worker.js / styles.css は削除しないでください。
現在オッズ・結果取得は既存Worker APIが正常に動作していることが前提です。

表示バージョン: Ver.8.2
