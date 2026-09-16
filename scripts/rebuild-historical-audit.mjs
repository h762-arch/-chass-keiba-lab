import fs from 'node:fs';
import {mergeHistoricalRows,summarizeHistoricalLedger} from '../src/research/historical-race-audit.mjs';

const [inputPath,outputPath]=process.argv.slice(2);
if(!inputPath||!outputPath)throw new Error('usage: node scripts/rebuild-historical-audit.mjs INPUT_JSON OUTPUT_JSON');
const matrix=JSON.parse(fs.readFileSync(inputPath,'utf8'));
const [headers,...values]=matrix;
const index=new Map(headers.map((name,i)=>[name,i]));
const get=(row,name)=>row[index.get(name)];
const sourceRows=values.map(row=>{
 const predictionExists=!!get(row,'予想存在'),indexPresent=!!get(row,'指数存在');
 return {
  originalRaceId:get(row,'Original_Race_ID'),
  date:get(row,'開催日'),
  organization:get(row,'主催'),
  track:get(row,'競馬場'),
  raceNo:get(row,'R'),
  raceName:get(row,'レース名'),
  predictionExists,
  preRace:!!get(row,'発走前予想存在'),
  final:!!get(row,'FINAL存在'),
  indexPresent,
  indexPreRaceAvailable:indexPresent,
  indexOnly:indexPresent&&!predictionExists,
  resultOfficial:!!get(row,'結果存在'),
  resultLinked:get(row,'結果連結状態')==='連結',
  AIWinPresent:!!get(row,'AI勝率存在'),
  AIPlacePresent:!!get(row,'AI複勝率存在'),
  TIMEPresent:!!get(row,'TIME存在'),
  BattleScorePresent:!!get(row,'勝負度Score存在'),
  PlaceScorePresent:!!get(row,'着拾いScore存在'),
  WinScorePresent:!!get(row,'勝ち切りScore存在'),
  aiWin:get(row,'AI勝率存在')?true:null,
  aiPlace:get(row,'AI複勝率存在')?true:null,
  predictedTime:get(row,'TIME存在')?true:null,
  battleScore:get(row,'勝負度Score存在')?true:null,
  placeScore:get(row,'着拾いScore存在')?true:null,
  winScore:get(row,'勝ち切りScore存在')?true:null,
  indexCluster:indexPresent?true:null,
  diamond:get(row,'💎存在')?true:null,
  caution:get(row,'⚠️存在')?true:null,
  marketOdds:get(row,'オッズ存在')?true:null,
  reconstructed:get(row,'除外理由')==='発走後再構成',
  source:get(row,'Source一覧'),
  confidence:get(row,'Prediction_Timestamp信頼度'),
  fullRanks:!!get(row,'全着順存在'),
  top3Only:!!get(row,'上位3頭のみ結果'),
  validationExists:!!get(row,'レース後検証存在'),
  popularityPresent:!!get(row,'人気存在'),
  exclusionReason:get(row,'除外理由'),
  sourceClass_FULL_FORMAL:get(row,'DataClass')==='FULL_FORMAL',
  sourceClass_PARTIAL_ELIGIBLE:get(row,'DataClass')==='PARTIAL_ELIGIBLE',
  sourceClass_REFERENCE_ONLY:get(row,'DataClass')==='REFERENCE_ONLY',
  sourceClass_INDEX_ONLY:get(row,'DataClass')==='INDEX_ONLY',
  sourceClass_UNUSABLE:get(row,'DataClass')==='UNUSABLE',
 };
});
const merged=mergeHistoricalRows(sourceRows),summary=summarizeHistoricalLedger(merged.ledger);
fs.writeFileSync(outputPath,JSON.stringify({...merged,summary},null,2));
console.log(JSON.stringify({sourceRows:sourceRows.length,ledgerRows:merged.ledger.length,normalizedRaceCount:merged.normalizedRaceCount,unresolvedSourceRows:merged.unresolvedSourceRows,aggregateRows:merged.aggregateRows.length,conceptualDuplicatesResolved:merged.conceptualDuplicatesResolved,summary},null,2));
