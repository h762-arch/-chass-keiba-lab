# Ver.9.9.25 Automatic Post-Race Result Queue

## 設計

- 予想保存時に `resultQueue` を既存 `race_json` へ保存します。
- NARから取得した発走時刻（JST）の10分後を初回確認時刻にします。時刻不明時は推測せず、自動通信しません。
- ブラウザは60秒ごとにキューだけを確認し、dueレースを最大3R、逐次処理します。
- Cloudflare Cronは5分ごとにdueレースを最大5R、逐次処理します。
- 通常通信はVer.9.9.22の `/api/nar/sync` を維持します。

## 再試行

`5分 → 5分 → 10分 → 15分 → 30分`。6回到達後は6時間休止して新しい再試行周期へ移ります。

## データ保護

- 新規テーブル、DROP TABLE、DELETE、全件初期化はありません。
- D1 binding `DB` とdatabase_idは変更していません。
- predictionSnapshot、モデルバージョン、AI確率、TIME、期待値、穴馬判定は変更しません。
