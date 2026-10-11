// Read-only, caller-declared source associations. No aliases or year inference.
import {adaptJraPdfEvidence} from './jra-pdf-evidence-adapter-v1.mjs';
const text=v=>typeof v==='string'?v.trim():'';
const fail=reason=>{throw new TypeError(reason);};
function records(table,headers,startRow) {
 if(!Array.isArray(table)||table.length>5001||!Array.isArray(table[0])||table[0].length>50||new Set(table[0]).size!==table[0].length||headers.some(h=>!table[0].includes(h))||!Number.isInteger(startRow)||startRow<2
   ||table.slice(1).some(r=>!Array.isArray(r)||r.length>table[0].length||r.some(v=>v!=null&&!['string','number','boolean'].includes(typeof v))))fail('IDENTITY_MAP_TABLE_INVALID');
 return table.slice(1).map((r,i)=>({row:startRow+i,data:Object.fromEntries(table[0].map((k,j)=>[k,r[j]??null]))}));
}
const validDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
export function resolveJraPdfEvidence({pdfInput,raceMapTable,horseMapTable,mapSpreadsheetId,raceMapStartRow=2,horseMapStartRow=2,historyDateEvidence=[]}={}) {
 if(!pdfInput||!text(mapSpreadsheetId)||!Array.isArray(historyDateEvidence)||historyDateEvidence.length>5000)fail('PDF_RESOLUTION_INPUT_REQUIRED');
 // Reject malformed PDF exports before interpreting any additional evidence.
 const input=structuredClone(pdfInput);input.associations=[];
 const base=adaptJraPdfEvidence(input),raceRows=records(raceMapTable,['SourceSystem','SourceSheet','SourceRace_ID','CanonicalRace_ID','Org','RaceDate','CourseRaw','R','MatchStatus'],raceMapStartRow);
 const horseRows=records(horseMapTable,['SourceSystem','SourceSheet','SourceHorse_Key','CanonicalHorse_Key','HorseName','OfficialHorse_ID','IdentityStatus'],horseMapStartRow);
 const maps=raceRows.filter(({data:r})=>r.SourceSystem==='SHEET'&&r.SourceSheet==='JRA_RACE_RUNNER'&&r.SourceRace_ID===input.sourceRaceId);
 const resolutionAudit=[],associations=[];
 const ref=(sheet,row)=>`${mapSpreadsheetId}/${sheet}/row/${row}`;
 const raceValid=maps.length===1&&maps[0].data.MatchStatus==='CONFIRMED'&&maps[0].data.Org==='JRA'&&maps[0].data.CanonicalRace_ID===input.canonicalRaceId
   &&maps[0].data.RaceDate===base.context.date&&maps[0].data.CourseRaw===base.context.course&&Number(maps[0].data.R)===base.context.raceNo;
 if(!raceValid) return {...base,status:'HOLD',resolutionAudit:[{reason:'PDF_RACE_MAP_UNCONFIRMED_OR_CONFLICT',matchCount:maps.length}],resolutionVersion:'JRA_PDF_IDENTITY_RESOLUTION_V1'};
 const rh=input.runnerTable[0],hh=input.historyTable[0];
 const value=(r,h,k)=>r[h.indexOf(k)];
 const selected=input.runnerTable.slice(1).filter(r=>value(r,rh,'Race_ID')===input.sourceRaceId);
 for(const runner of selected) {
  const sourceKey=value(runner,rh,'Horse_Key'),name=value(runner,rh,'馬名'),no=Number(value(runner,rh,'馬番'));
  const matches=horseRows.filter(({data:r})=>r.SourceSystem==='SHEET'&&r.SourceSheet==='JRA_RACE_RUNNER'&&r.SourceHorse_Key===sourceKey);
  const m=matches[0]?.data,confirmed=matches.length===1&&m.IdentityStatus==='CONFIRMED'&&m.HorseName===name&&text(m.OfficialHorse_ID)&&text(m.CanonicalHorse_Key)&&!/^(TEMP|UNKNOWN|UNRESOLVED)(\||$)/.test(m.CanonicalHorse_Key);
  if(!confirmed){resolutionAudit.push({horseNo:no,reason:'PDF_HORSE_MAP_UNCONFIRMED_OR_CONFLICT',matchCount:matches.length});continue;}
  associations.push({sourceRaceId:input.sourceRaceId,canonicalRaceId:input.canonicalRaceId,sourceHorseKey:sourceKey,horseNo:no,horseName:name,canonicalHorseKey:m.CanonicalHorse_Key,status:'PASS',evidenceRef:ref('CHASS_HORSE_KEY_MAP',matches[0].row)});
  for(const row of input.historyTable.slice(1).filter(r=>value(r,hh,'Race_ID')===input.sourceRaceId&&value(r,hh,'Horse_Key')===sourceKey)) {
   const rawDate=value(row,hh,'過去走日付'),runNo=Number(value(row,hh,'Run_No'));
   if(!/^\d{2}\/\d{2}$/.test(rawDate))continue;
   const proofs=historyDateEvidence.filter(p=>p&&p.sourceRaceId===input.sourceRaceId&&p.sourceHorseKey===sourceKey&&p.canonicalHorseKey===m.CanonicalHorse_Key&&p.horseNo===no&&p.horseName===name&&p.runNo===runNo&&p.rawDate===rawDate);
   const p=proofs[0],features=['競馬場','芝ダ','距離','着順','走破TIME'];
   const valid=proofs.length===1&&p.status==='PASS'&&text(p.evidenceRef)&&validDate(p.fullDate)&&p.fullDate.slice(5).replace('-','/')===rawDate&&p.fullDate<base.context.date
    &&features.every(k=>hh.includes(k)&&value(row,hh,k)!=null&&value(row,hh,k)!==''&&value(row,hh,k)!=='UNKNOWN'&&p.pdfFeatures?.[k]===value(row,hh,k));
   if(!valid){resolutionAudit.push({horseNo:no,runNo,rawDate,reason:'PDF_HISTORY_DATE_PROOF_MISSING_OR_CONFLICT',matchCount:proofs.length});continue;}
   row[hh.indexOf('過去走日付')]=p.fullDate;
   resolutionAudit.push({horseNo:no,runNo,rawDate,fullDate:p.fullDate,reason:'PDF_HISTORY_DATE_ASSOCIATED',evidenceRef:p.evidenceRef});
  }
 }
 if(new Set(associations.map(a=>a.canonicalHorseKey)).size!==associations.length)fail('PDF_RESOLVED_CANONICAL_KEY_REUSED');
 const confirmedIds=horseRows.filter(r=>associations.some(a=>a.evidenceRef===ref('CHASS_HORSE_KEY_MAP',r.row))).map(r=>r.data.OfficialHorse_ID);
 if(new Set(confirmedIds).size!==confirmedIds.length)fail('PDF_OFFICIAL_ID_REUSED');
 const result=adaptJraPdfEvidence({...input,associations});
 return {...result,resolutionVersion:'JRA_PDF_IDENTITY_RESOLUTION_V1',resolutionAudit,raceMapRef:ref('CHASS_RACE_ID_MAP',maps[0].row),
  sourceAuthentication:'UNVERIFIED',trustedTiming:'UNVERIFIED',identityProof:'CALLER_DECLARED_MAP_AND_HISTORY_ASSOCIATIONS'};
}
