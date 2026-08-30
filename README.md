# CHASS KEIBA LAB Ver.9.8.9

地方競馬の予想、予想時点Snapshot固定、NAR公式結果取得、レース後検証を行う研究アプリです。

## 現在の保存構造

- IndexedDBを主保存先として使用
- IndexedDBが利用できない場合はlocalStorageへフォールバック
- 既存localStorageデータは削除せず移行
- predictionSnapshot / marketSnapshot / finalSnapshot / resultSnapshot / validationSnapshotを分離
- 結果取得後も予想時点Snapshotを自動上書きしない

## TIME

- 標準TIME
- 展開ハマりTIME
- 展開不利TIME
- 実績TIMEと距離補正TIMEを区別
- ダッシュボードでMAE、Mean Error、方向別誤差、シナリオ最接近率を検証

## 検証ダッシュボード

- 実績ベースの失敗、検証候補、データ不足を分離
- AI勝率・AI TOP3率を確率帯別に較正
- AI TOP3率と出走頭数別の正式複勝対象を別集計
- Wilson法による95%信頼区間を較正・モデル比較に表示
- 分析品質フィルタで低品質レースを統計から明示的に除外可能
- モデルVer別にFINAL勝率・TOP3率・TIME MAEを比較
- 率には成功数/対象数と母数信頼度を表示
- 中央/地方、競馬場、期間、データ品質で絞り込み
- 保存レースから当時の予想画面へ戻ることが可能

## Development checks

Node.js 20以上で、外部テストライブラリやライブNAR通信なしに回帰テストを実行できます。

```sh
npm test
npm run check
```

`regression.test.mjs`が`nar-fixtures.mjs`の固定fixtureを読み込み、Snapshot固定、TOP3・正式複勝判定、95%信頼区間、診断分類、較正、TIME、NAR Parser、旧データ移行を検証します。

## Compatibility

`chass-latest.js`は旧配置との互換性を維持するためのlegacy compatibility placeholderです。現在の本体処理は`app.js`に統合されています。
