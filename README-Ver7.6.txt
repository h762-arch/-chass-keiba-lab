CHASS KEIBA LAB Ver.7.6 追加手順

目的
- AIフェア倍率・実オッズ・期待回収率を完全分離
- 「実オッズ」と確認できた場合だけ期待回収率を確定表示
- 市場オッズ履歴をレース単位で保存
- NAR「最終」オッズを最終市場として保存
- 検証ダッシュボードの表をiPhoneではカード型表示
- Ver.7.6へ表示更新

追加ファイル
1. chass-v7.6-patch.js

index.html の一番下を次の順にしてください。

  <script src="app.js"></script>
  <script src="/chass-v7.4-patch.js"></script>
  <script src="/chass-v7.5-patch.js"></script>
  <script src="/chass-v7.6-patch.js"></script>
</body>
</html>

もし Ver.7.4 patch を既に Ver.7.5 patch に統合して削除している場合は、
現在読み込んでいる既存パッチの「最後」に Ver.7.6 を追加すればOKです。

重要
- worker.js が公開ファイルを PUBLIC_PATHS で制限している場合、
  "/chass-v7.6-patch.js"
  を PUBLIC_PATHS に追加してください。
- 現在の worker.js が全静的アセットを env.ASSETS へ渡す構成なら追加不要です。

Ver.7.6の市場表示ルール
- 市場未取得：
  AIフェア 8.0倍
  実オッズ —
  期待回収率 —（市場未取得）

- 予想オッズ：
  AIフェアは表示
  実オッズは「—」
  期待回収率は確定表示しない

- 実オッズ：
  AI勝率 × 実単勝オッズ
  で期待回収率を表示

保存
- localStorage に市場スナップショットを保存
- 通常のレース保存データにも marketSnapshots / marketFirst / marketFinal を追加

