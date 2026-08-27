チャス競馬研究所 Ver.8.0 完成統合版

この版は Ver.7.x の追加パッチ方式を廃止し、Ver.8.0 単体で動作するように一本化しています。

ファイル:
- index.html
- app.js
- styles.css
- worker.js
- manifest.webmanifest

主な改善:
- JSON読込後にレース情報が初期化される問題を解消
- 予想TIMEが0頭でもAI勝率・複勝率を計算
- TIMEは根拠がない場合に捏造せず「—」
- 生タイム指数と0〜10内部スコアを分離
- 最高・5走平均・距離・コース・近走指数を統合
- 斤量kgをスコアとして直接扱わない
- 実オッズ/予想オッズを分離
- AIフェア倍率と期待回収率を分離
- 💎/💎💎💎/⚠️を自動判定
- レースID YYYY-MM-DD|競馬場|R で完全分離
- NAR結果/最終オッズ取得
- 検証ダッシュボード
- iPhone向けUI

導入:
Cloudflare Workers Static Assets のプロジェクトで、既存の index.html / app.js / styles.css / worker.js / manifest.webmanifest をこの5ファイルへ置き換えてください。
古い chass-v7.x-patch.js / chass-v8.0-patch.js は index.html から読み込まないでください。

重要:
worker.js は env.ASSETS へ静的ファイルをそのまま渡す方式なので、PUBLIC_PATHSの追加は不要です。

確認:
デプロイ後に画面上部が「Ver.8.0」になれば新バージョンが反映されています。
