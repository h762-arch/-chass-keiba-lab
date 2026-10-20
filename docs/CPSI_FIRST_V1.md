# CPSI FIRST v1 — 指数読込直後の独立先行計算

## 根拠と採用範囲

- BOX原案 APP-20261019-0100「JRA_CPSI波乱度_SourceRecovery_R2」:
  https://docs.google.com/document/d/1P2Z7WbovBH09C3TA6jhoSTiG8iw23B6JKoP45cXzURs/edit
- 正本 CPSI_INLINE_NUMERIC_COMPAT_v1.0:
  https://docs.google.com/document/d/1ACIlygzu-ibx6y6kMKCl3-Y-Vgr7KRZ-w2g1ZVK-seE/edit
- 変更基準: main 4718da062b87ded92641647983081ed75b3f0c19。
- 今回は市場非参照のCPSI先行計算、前夜PRE、Core適格性、保存値の独立比較を採用する。R2のWave部分計算やDrive全件Source Recoveryを丸ごと移植しない。

## 利用経路

予想入力の「CPSIを先に計算」から正規事前指数JSONを読み込む。既存の一般JSON読込でも、transform/予想保存より先に同じ計算を行い、描画機会を渡す。formatが `CHASS_CPSI_PRE_INPUT_V1` のファイルはCPSIのみで終わり、Prediction/Market/FINAL/ResultやD1の保存を行わない。

入力は既存の `race.metricInputFreeze` と、`race.cpsiCanonicalIndexSnapshot` または馬別 `canonicalIndex` を持つrace/horses形式。通常の能力点、highest/avg5、人気等を正規PRE指数として自動昇格させない。足りない場合はCPSI【NA】と理由を表示する。直接のGoogle Drive/Sheets自動検索・Source認証・JSONエクスポーターはこのパッチには含まれない。通常の公式出馬表APIだけで常にCPSI数値が出ると解釈しない。

例（値は合成例。実資料の時刻・ID・出所を捏造しない）:

```json
{
  "format": "CHASS_CPSI_PRE_INPUT_V1",
  "race": {
    "category": "中央競馬", "raceType": "JRA",
    "raceDate": "2026-10-21", "track": "東京", "raceNo": 1,
    "surface": "芝",
    "metricInputFreeze": {
      "runId": "ACTUAL_RUN", "inputSnapshotId": "ACTUAL_FREEZE",
      "indexSnapshotId": "ACTUAL_INDEX",
      "freezeAt": "2026-10-20T23:00:00+09:00",
      "postAt": "2026-10-21T10:00:00+09:00"
    }
  },
  "horses": [
    {
      "horseNo": 1, "canonicalHorseKey": "ACTUAL_HORSE_KEY_1",
      "canonicalIndex": {
        "organizer": "JRA", "raceId": "2026-10-21|東京|1",
        "runId": "ACTUAL_RUN", "inputSnapshotId": "ACTUAL_FREEZE",
        "kind": "EARLY", "isPreResult": true,
        "capturedAt": "2026-10-20T22:00:00+09:00",
        "authorityRef": "ACTUAL_INDEX_AUTHORITY",
        "sourceClass": "CANONICAL_INDEX_PRE", "sourceSnapshotId": "ACTUAL_INDEX",
        "peak": 90, "baseline5": 80, "current": 75, "distance": 70, "course": 65
      }
    }
  ]
}
```

例は構造説明の1頭のみ。実計算は全出走馬の同一Run/同一指数Snapshotを渡す。比較対象が2頭未満なら計算しない。取消・除外は別状態として保持し、参加母集団から除く。馬名は結合キーにしない。CanonicalHorseKeyが無い入力は既存契約どおりRACE_HORSE_NO_SHADOW_ONLYとして区別する。

## 計算の分離と厳格性

新しい `projectAndCalculateCpsiShadow` は正規指数、認可済みD-G成分、固定情報、対象レース/出走馬のみを選択して渡す。市場/Wave本文・人気/オッズ・marketSnapshotIdは取得も参照もしない。直接API `calculateCpsiShadow` へ市場などを渡すと拒否する。JRA/NARは同じ純粋CPSI契約を使うが、組織・レース・Run・Snapshotの混在は拒否する。

先行経路だけ、前夜のPRE取得時刻・cutoffを許可する。開催日への一致はpostAtで確認し、全資料の対象Race/Run/Input/Index、capture <= cutoff <= check < postを守る。時刻やSource Refの自己ラベルは出所認証ではない。既存の合算CPSI/Wave経路の同日境界やWave式は変更しない。

正本§6に合わせて `PARTIAL_NEUTRAL_PRIMITIVE` をCoreUsableに数えない。A+BまたはA+C完備等、適格Coreが2つ以上のときのみMainCompat/順位を表示する。A+片側Cだけでは数値順位を出さない。Cの片側中立補完はMainCompatの成分としては保持し、UNKNOWN、PartialWeight、中立補完率を隠さない。重み(.20/.20/.20/.15/.10/.10/.05)、RR tie/singleton、Prev proxy、ResolvedOnlyの式は変更しない。

画面はレースID/JRA-NAR、全頭のCPSI/順位、Core数、充足率、中立補完率、不確実性、前走代理、C片側欠損を表示する。SHADOWであり正式CPSI・確率・自動印ではない。新馬/障害/ばんえいは対象外。結果を含む入力、発走後の再構築は拒否する。

## 保存値の独立比較

任意の `savedCpsiShadow` を付けると、元の正規指数から新規計算し、contract/race/run/input/index/cutoffと比較用入力本文、全成分/重み/数値/順位/件数/不確実性を比較する。

- FORMULA_MATCH: 成分・数式・比較用入力が一致しただけ。
- COMPONENT_MISMATCH: 成分・数値・順位・件数等が相違。
- SOURCE_CONFLICT: 入力または保存単位が相違。
- UNVERIFIED: 成分元資料や比較本文等が不足。

`sourceOriginAuthenticated:false` と `physicalReadbackVerified:false` は常に保持する。Drive保存値があるだけで検証済みとしない。ファイル読込やプレビューは元のEARLY/Signalを改変せず、既存Snapshotへの後付けもしない。保存と物理readbackの別アダプター接続は未実装。

## 検証・Rollback

合成データでJRA/NAR、前夜、時刻、対象外、Market Getter非参照、C片側Core、Prev、欠損、出所/馬番混在、保存改竄、既存EARLY不変、同時ファイル読込を試験。実ブラウザで320/390/430pxのファイル入力とオッズ取得0・POST0・予想未生成を確認する。

未見実レースの元資料取得、出所認証、Drive/D1物理保存読戻、予測精度/ROI改善は未確認。正式KPI HOLD、Probability MODEL_HOLD、Production activation NO-GOは維持。RollbackはこのPRのrevert。係数・marks/正式💎⚠️・確率・EV・EARLY/KPI/Worker/D1/cron/workflow変更はしない。
