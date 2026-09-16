import fs from 'node:fs';
const data=JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const stamp=new Date().toISOString();
const headers=['Normalized_Race_ID','Original_Race_ID','開催日','主催','競馬場','R','レース名','予想存在','発走前予想存在','FINAL存在','指数存在','結果存在','全着順存在','上位3頭のみ結果','レース後検証存在','AI勝率存在','AI複勝率存在','TIME存在','勝負度Class存在','勝負度Score存在','着拾いScore存在','勝ち切りScore存在','オッズ存在','人気存在','💎存在','⚠️存在','Prediction_Timestamp信頼度','結果連結状態','Source一覧','正式KPI可否','部分学習可否','指数研究可否','除外理由','DataClass','監査日時'];
const ledger=[headers,...data.ledger.map(row=>[
 row.Normalized_Race_ID||null,(row.originalRaceIds?.length?row.originalRaceIds.join(' | '):row.Original_Race_ID)||null,row.date||null,row.organization||null,row.track||null,row.raceNo??null,row.raceName||null,
 !!row.predictionExists,!!row.preRace,!!row.final,!!row.indexPresent,!!row.resultOfficial,!!row.fullRanks,!!row.top3Only,!!row.validationExists,!!row.AIWinPresent,!!row.AIPlacePresent,!!row.TIMEPresent,!!row.BattleScorePresent,!!row.BattleScorePresent,!!row.PlaceScorePresent,!!row.WinScorePresent,!!row.marketOdds,!!row.popularityPresent,!!row.diamond,!!row.caution,row.confidence||'不明',row.resultLinked?'連結':'未連結',(row.sources?.length?row.sources.join(' | '):row.source)||null,
 row.DataClass==='FULL_FORMAL',row.DataClass==='PARTIAL_ELIGIBLE',!!row.indexPreRaceAvailable,row.Normalized_Race_ID?(row.exclusionReason||null):'Race_ID正規化不能',row.DataClass,stamp
])];
const rescueHeaders=['Normalized_Race_ID','Original_Race_ID','Source','Audit_Class','Action','Audit_Timestamp','Authenticity','Promoted','Exclusion_Reason','Readback_Status'];
const rescueRows=[];
for(const row of data.ledger.filter(row=>row.DataClass!=='FULL_FORMAL')){
 rescueRows.push([row.Normalized_Race_ID||null,(row.originalRaceIds?.length?row.originalRaceIds.join(' | '):row.Original_Race_ID)||null,(row.sources?.length?row.sources.join(' | '):row.source)||null,row.Normalized_Race_ID?row.DataClass:'UNRESOLVED_SOURCE','AUDIT_ONLY',stamp,'不明',false,row.Normalized_Race_ID?(row.exclusionReason||'正式KPI対象外'):'Race_ID正規化不能','READBACK_PENDING_V2']);
}
for(const row of data.aggregateRows)rescueRows.push([null,row.Original_Race_ID,row.source||null,'AGGREGATE_NOT_A_RACE','AUDIT_NOTE_ONLY',stamp,'不明',false,'日次集約行はRace母数から除外','READBACK_PENDING_V2']);
const rescue=[rescueHeaders,...rescueRows];
const hub=[['全履歴監査 v3','現在値','区分','監査メモ'],['Source rows',135,'入力監査','v1派生台帳のsource row'],['Normalized races',data.normalizedRaceCount,'Race identity','正規化成功Raceのみ'],['Unresolved source rows',data.unresolvedSourceRows,'要確認','normalized母数へ含めない'],['Aggregate/day rows',data.aggregateRows.length,'監査注記','Race母数へ含めない'],['Conceptual duplicates resolved',data.conceptualDuplicatesResolved,'統合','元行・source provenance保持']];
const labels={Race_Total:'真のRace総数',Pre_Race:'発走前予想あり',FINAL:'FINALあり',Result_Linked:'Result linked',FULL_FORMAL:'FULL_FORMAL',PARTIAL_ELIGIBLE:'PARTIAL_ELIGIBLE',REFERENCE_ONLY:'REFERENCE_ONLY',INDEX_ONLY:'INDEX_ONLY',UNUSABLE:'UNUSABLE',AIWin:'AIWin利用可能',AIPlace:'AIPlace利用可能',TIME:'TIME利用可能',WinScore:'WinScore利用可能',PlaceScore:'PlaceScore利用可能',BattleScore:'BattleScore利用可能',Index_PreRace_Available_Races:'Index_PreRace_Available_Races',Index_Result_Linked_Races:'Index_Result_Linked_Races',Composite:'Composite利用可能'};
for(const org of ['JRA','NAR'])for(const [key,value] of Object.entries(data.summary[org]))hub.push([`${org} ${labels[key]||key}`,value,'統一集計',key.startsWith('Index_')?'同一summarizeHistoricalLedger()定義':'v2 identity統合後']);
console.log(JSON.stringify({ledger,rescue,hub}));
