# EARLY集計境界 v1 — PR #256後の整理

基準main: `0c74284c8a5f98d0407ba20c7aee80f660f9eda6`。
開始時の全ソースtreeは `433e5d4e14d6948ecf8bf4e30aed5f6321033bd7` と一致。

## この変更で進めたこと

1. ブラウザに残る保存済み予想・FINAL・事後の穴候補再計算を**参考集計**と明示した。
2. EARLY正式集計の状態を別枠でHOLDと表示する。保存場所、FNV seal、`formalKpiEligible:true` だけでは昇格しない。
3. JRA/NARの証拠付き集計の内部入口を `summarizeEarlyEvidenceCohort` に集約した。既存JRA readerを再利用し、NARの未接続をHOLD理由にする。
4. 既存JRA readerの発走時刻、取得・計算順序、結果混入、全頭照合の検証を厳格化した。

正式KPIの認証完了やProduction昇格ではない。**Formal KPI HOLD / Probability MODEL_HOLD / Production NO-GO**。

## ブラウザ側の変更

`index.html → jra-browser-bootstrap.mjs → early-kpi-dashboard-boundary-v1.mjs → app.js` の順で表示境界を用意する。

- 「D1を正式な母集団」としていた説明を変更。D1に保存されていることと、レース前の正式固定の証明は別に扱う。
- EARLY正式集計のカードを追加。ここから正式成績への加算は常に0R、状態はHOLD。
- FINAL TOP3、穴候補の再計算捕捉、TIME、詳細集計を参考と表示する。
- 古い穴馬比較の「現行9.9.2／新9.9.3」を、旧ルール／現行シグナルルールの参考再計算と表示する。
- 既存の参考集計の数式・母数・品質フィルターは変更しない。予想・保存Snapshot・印を再計算して書き換えない。
- 境界モジュールを読み込めない場合も、正式HOLDと参考表示を維持する。空母数を0.0%の実績として表示しない。
- JRA/NAR、過去研究、Snapshot欠損を表示用メタデータとして分ける。ブラウザ側のフラグは出典認証ではない。

「加算0R」はこの表示入口からの昇格がないという意味。別の証拠台帳に正式対象が存在しないという意味ではない。

新しいブラウザ公開moduleは副作用のない表示境界1ファイルだけ。.assetsignoreにexact pathを追加し、内部cohort reader・D1 reader・Node内部moduleは引き続き非公開。公開APIのroute、Worker、server、runtime flag、workflowは変更しない。

## 共通の内部集計入口

```js
import {summarizeEarlyEvidenceCohort} from './src/research/early-kpi-cohort-v1.mjs';
const result = await summarizeEarlyEvidenceCohort({
  DB, // 呼び出し元が供給するD1互換の読み取りbinding
  targets: [
    {organization:'JRA',raceId:'20261004-JRA-東京-11'},
    {organization:'NAR',raceId:'2026-10-04|高知|7'}
  ],
  now: Date.now()
});
```

- 最大100R、明示的なraceIdだけ。重複、組織・競馬場・日付の矛盾、計算済みcomparisonの持ち込みは拒否。
- JRAは既存の `summarizeJraEarlyResultKpi → compareJraEarlyToOfficialResult → readJraEarlyResearchSnapshot` を呼ぶ。新しい予想式を作らない。
- JRA DATAは固定versionの最初のnonempty revisionを選択。その行が壊れていても後のrevisionへ進まない。
- NARは `NAR_AUTHENTICATED_OUTCOME_READER_NOT_WIRED`。JRAの比較や合成入力で代用しない。
- `contractQualifiedRaceCount` は保存行契約の条件に合った候補数。真正な事前固定が独立認証された正式件数ではない。
- requested = contractQualified + held。HOLD/PENDING/拒否は理由別に残し、敗戦や0%として計上しない。
- JRA/NARの平均は混ぜない。Brier/TIMEは既存のレース平均の平均。runner加重平均や全頭MAEとは混同しない。
- T15/T5、現在オッズ、FINALの取得は要件に追加しない。EARLYの固定証明と確定結果が評価の中心。
- SELECTのみ。ネットワーク、取得callback、保存、schema修復、freeze、D1書き込みはない。
- raw API応答、snapshot本体、sourceRef、RESULT本文は共通集計出力に含めない。

## JRA readerの修正

| 問題 | 修正 |
|---|---|
| 発走時刻と同時刻のsource/calculationをPREとして許す | PREは厳密に発走より前。等号は拒否 |
| 結果取得が発走時刻と同時でも許す | 結果は発走時刻より後。等号は拒否 |
| source検証時刻が計算時刻より後でも許す | sourceValidatedAt <= dataCalculatedAtを確認 |
| timezoneなしの時刻や不正な日付 | 明示的timezone・実在日付を検証 |
| 未知の競馬場、不正revision、不正rank | reader契約として拒否 |
| DATAに現在のRESULT/実TIME等が混入 | 既知の現在結果フィールドを拒否。過去走のfinish値は現在結果と混同しない |
| 事後生成のreference DATAを受理 | historical/backtest markerがある場合は参考限定として拒否 |
| 予想にいる馬の結果が欠けてもformalKpiEligibleとなる | 比較は参考として残し、formal eligibilityはfalse。集計母数から除外し理由を残す |
| 結果に予想外の馬が追加されても無視 | 同一fieldの照合不一致として拒否 |

欠損・取消・中止・同着などで現行の順位schemaに表現できないケースを、敗戦や推定順位で補わない。完全なfield照合がないレースは正式候補へ入れず、対応する結果schemaと事前出走状態の研究が必要。

結果混入の検査は保守的なフィールド検査である。たとえばnestedな`actualTime`が過去走由来か現在結果かを独立証明できない入力はHOLDになる。過去走の`finish`値は許容するが、曖昧な実TIMEを推定で救済しない。

既存の`formalKpiEligible`/`formalRaceCount`という名称は互換性のため残るが、その意味を`STORED_ROW_CONTRACT_ONLY`と明記した。共通入口はこれを`contractQualifiedRaceCount`として出し、正式readinessは常にHOLD。

## 出典・時刻の限界

このreaderは、呼び出し元が与えたDB行と`now`の整合性を確認する。外部の時刻アンカー、source hashの独立認証、当時の実発走、取消の網羅性、DB行の改ざん防止は証明しない。`sourceOriginAuthenticated:false`を維持する。

FNVの整合性検査、D1保存場所、`JRA_OFFICIAL`という文字列、合成テストの成功だけを正式化の根拠にしない。正規source/Run/Freeze/時刻の証拠と実際の結果台帳の監査は、次の接続工程で必要。

この変更は内部readerと参考UIの分離まで。認証済みDB集計をブラウザへ返す新APIは作っていない。NAR認証済み結果readerも未接続。これらを実装済みとは扱わない。

## 検証

```sh
node --test tests/early-kpi-boundary-v1.test.mjs tests/jra-early-research-reader.test.mjs tests/jra-early-result-kpi.test.mjs tests/jra-early-kpi-summary.test.mjs tests/browser-asset-boundary.test.mjs
node scripts/audit-app-architecture-v1.mjs
npm run check
```

実データは取得していない。検証fixtureはすべてschema/回帰確認用で、未見成績・ライブSmoke成功・元のNARエラー解消の証拠ではない。実行件数・全体テストの制約・適用検査・hashは同梱のvalidation JSONとログに記録する。

## 次の優先工程

1. 正規EARLY sourceの保全・時刻証明・Run/Freeze結合と、結果台帳の認証済み読み取りを共通入口へ接続する。
2. NARの結果・取消・中止・出走馬identityのreaderを設計し、JRAと混ぜず検証する。
3. 正式/参考のデータ交換契約が固まってから、単一Signal policyとCPSI authorityのadapterを統合する。
4. その後、Win/Top3、Final5除外、CPSI不確実性、実際の購入台帳の回収頑健性を未見検証する。

https://github.com/h762-arch/-chass-keiba-lab/commit/0c74284c8a5f98d0407ba20c7aee80f660f9eda6
