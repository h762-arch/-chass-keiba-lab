import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveJraPdfEvidence as resolve} from '../src/research/jra-pdf-identity-resolution-v1.mjs';
import {createPredictionEvidenceSnapshot} from '../src/research/prediction-evidence-bridge-v1.mjs';
const table=objects=>{const headers=[...new Set(objects.flatMap(Object.keys))];return [headers,...objects.map(o=>headers.map(k=>o[k]??null))];};
const set=(t,k,v,row=1)=>t[row][t[0].indexOf(k)]=v;
function fixture() {
 const sourceRaceId='20261011_東京_1',canonicalRaceId='20261011-JRA-TOK-01';
 const features={'競馬場':'新潟','芝ダ':'ダート','距離':'1600','着順':'4','走破TIME':'1:42.0'};
 return {mapSpreadsheetId:'synthetic-master',pdfInput:{sourceRaceId,canonicalRaceId,sourceSpreadsheetId:'synthetic-pdf',
 manifestTable:table([{Race_ID:sourceRaceId,'開催日':'2026-10-11','競馬場':'東京','レース番号':1,'芝ダ障':'ダート','距離':1600,'出走頭数':2}]),
 runnerTable:table([1,2].map(n=>({Race_ID:sourceRaceId,'開催日':'2026-10-11','競馬場':'東京',R:1,'馬番':n,'馬名':`馬${n}`,Horse_Key:`TEMP|馬${n}`,'取消状態':'UNKNOWN','斤量':55}))),
 historyTable:table([1,2].flatMap(n=>[1,2,3,4,5].map(run=>({Race_ID:sourceRaceId,Horse_Key:`TEMP|馬${n}`,'馬番':n,'馬名':`馬${n}`,Run_No:run,'過去走日付':'08/02',...features})))),
 statuses:[1,2].map(n=>({sourceRaceId,horseNo:n,horseName:`馬${n}`,status:'ACTIVE',evidenceRef:'synthetic/status'}))},
 raceMapTable:table([{SourceSystem:'SHEET',SourceSheet:'JRA_RACE_RUNNER',SourceRace_ID:sourceRaceId,CanonicalRace_ID:canonicalRaceId,Org:'JRA',RaceDate:'2026-10-11',CourseRaw:'東京',R:1,MatchStatus:'CONFIRMED'}]),
 horseMapTable:table([1,2].map(n=>({SourceSystem:'SHEET',SourceSheet:'JRA_RACE_RUNNER',SourceHorse_Key:`TEMP|馬${n}`,CanonicalHorse_Key:`JRA|${n}`,HorseName:`馬${n}`,OfficialHorse_ID:`synthetic-${n}`,IdentityStatus:'CONFIRMED'}))),
 historyDateEvidence:[1,2].flatMap(n=>[1,2,3,4,5].map(run=>({sourceRaceId,sourceHorseKey:`TEMP|馬${n}`,canonicalHorseKey:`JRA|${n}`,horseNo:n,horseName:`馬${n}`,runNo:run,rawDate:'08/02',fullDate:'2026-08-02',status:'PASS',evidenceRef:`synthetic/date/${n}/${run}`,pdfFeatures:features}))) };
}
test('confirmed maps and exact full-date proofs connect without changing PDF inputs',()=>{
 const f=fixture(),before=structuredClone(f),out=resolve(f);assert.deepEqual(f,before);assert.equal(out.status,'READY_FOR_UNVERIFIED_RESEARCH_SNAPSHOT');
 assert.equal(out.joinedCount,2);assert.equal(out.history.length,11);assert.equal(out.resolutionAudit.length,10);assert.equal(out.resolutionAudit[0].rawDate,'08/02');
 assert.equal(out.formalKpiEligible,false);assert.equal(out.freezeMutation,'NONE');assert.equal(out.sourceAuthentication,'UNVERIFIED');
});
test('resolved tables enter existing Snapshot bridge with caller timing declarations',async()=>{
 const out=resolve(fixture()),snapshot=await createPredictionEvidenceSnapshot({...out,raceId:out.canonicalRaceId,runId:'synthetic-run',modelVersion:'synthetic',cutoffAt:'2026-10-11T00:00:00Z',offAt:'2026-10-11T01:00:00Z',source:{spreadsheetId:out.sourceSpreadsheetId,revision:'synthetic',exportedAt:'2026-10-10T23:00:00Z',availableAt:'2026-10-10T22:00:00Z'}});
 assert.equal(snapshot.data.horses.length,2);assert.equal(snapshot.formalKpiEligible,false);
});
test('provisional keys and missing official ID stay HOLD',()=>{
 for(const [k,v] of [['IdentityStatus','PROVISIONAL'],['OfficialHorse_ID',''],['CanonicalHorse_Key','TEMP|1'],['HorseName','other']]){const f=fixture();set(f.horseMapTable,k,v);assert.equal(resolve(f).joinedCount,1);}
});
test('ambiguous race and mismatched date course or race cannot pass',()=>{
 for(const [k,v] of [['RaceDate','2026-10-10'],['CourseRaw','京都'],['R',2],['MatchStatus','PROVISIONAL'],['CanonicalRace_ID','other']]){const f=fixture();set(f.raceMapTable,k,v);assert.equal(resolve(f).resolutionAudit[0].reason,'PDF_RACE_MAP_UNCONFIRMED_OR_CONFLICT');}
 const f=fixture();f.raceMapTable.push([...f.raceMapTable[1]]);assert.equal(resolve(f).status,'HOLD');
});
test('duplicate horse map and foreign source sheet cannot confirm a runner',()=>{
 const f=fixture();f.horseMapTable.push([...f.horseMapTable[1]]);assert.equal(resolve(f).joinedCount,1);
 const g=fixture();set(g.horseMapTable,'SourceSheet','other');assert.equal(resolve(g).joinedCount,1);
});
test('duplicate canonical keys or official IDs reject',()=>{
 for(const key of ['CanonicalHorse_Key','OfficialHorse_ID']){const f=fixture();set(f.horseMapTable,key,f.horseMapTable[1][f.horseMapTable[0].indexOf(key)],2);assert.throws(()=>resolve(f),/REUSED/);}
});
test('date proof must match exact race key number name slot and raw date',()=>{
 for(const [k,v] of [['sourceRaceId','other'],['sourceHorseKey','other'],['canonicalHorseKey','other'],['horseNo',3],['horseName','other'],['runNo',6],['rawDate','08/03']]){const f=fixture();f.historyDateEvidence[0][k]=v;assert.equal(resolve(f).status,'HOLD');}
});
test('missing and ambiguous date proofs never infer a year',()=>{
 const f=fixture();f.historyDateEvidence=[];assert.equal(resolve(f).history.length,1);
 const g=fixture();g.historyDateEvidence.push({...g.historyDateEvidence[0]});assert.equal(resolve(g).status,'HOLD');
});
test('date proofs require evidence, same month/day and valid prior calendar date',()=>{
 for(const [k,v] of [['fullDate','2026-08-03'],['fullDate','2027-08-02'],['fullDate','2026-02-30'],['evidenceRef',''],['status','HOLD']]){const f=fixture();f.historyDateEvidence[0][k]=v;assert.equal(resolve(f).status,'HOLD');}
});
test('independent date evidence must agree with course surface distance finish and time',()=>{
 for(const k of ['競馬場','芝ダ','距離','着順','走破TIME']){const f=fixture();f.historyDateEvidence[0].pdfFeatures={...f.historyDateEvidence[0].pdfFeatures,[k]:'wrong'};assert.equal(resolve(f).status,'HOLD');}
});
test('unknown placeholder dates cannot be filled from unrelated evidence',()=>{
 const f=fixture();set(f.pdfInput.historyTable,'過去走日付','UNKNOWN');const out=resolve(f);assert.equal(out.status,'HOLD');assert.ok(out.failures.some(f=>f.reason==='PDF_HISTORY_DATE_MISSING'));
});
test('mapping does not manufacture starter state',()=>{
 const f=fixture();delete f.pdfInput.statuses;const out=resolve(f);assert.equal(out.status,'HOLD');assert.equal(out.failures.filter(f=>f.reason==='PDF_RUNNER_STATUS_UNCONFIRMED').length,2);
});
test('original map row offsets and independently supplied status are retained',()=>{
 const out=resolve({...fixture(),raceMapStartRow:50,horseMapStartRow:100});assert.match(out.raceMapRef,/row\/50$/);assert.match(out.identityMap[0].evidenceRef,/row\/100$/);
});
test('mapping and proof batches are bounded with scalar map cells',()=>{
 const f=fixture();f.historyDateEvidence=Array(5001).fill({});assert.throws(()=>resolve(f),/INPUT_REQUIRED/);
 const g=fixture();set(g.horseMapTable,'HorseName',{});assert.throws(()=>resolve(g),/TABLE_INVALID/);
});
