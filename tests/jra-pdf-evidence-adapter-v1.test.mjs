import test from 'node:test';
import assert from 'node:assert/strict';
import {adaptJraPdfEvidence as adapt} from '../src/research/jra-pdf-evidence-adapter-v1.mjs';
import {createPredictionEvidenceSnapshot} from '../src/research/prediction-evidence-bridge-v1.mjs';
const table=objects=>{const keys=[...new Set(objects.flatMap(Object.keys))];return [keys,...objects.map(o=>keys.map(k=>o[k]??null))];};
const set=(t,k,v,row=1)=>t[row][t[0].indexOf(k)]=v;
function fixture() {
 const sourceRaceId='20261011_東京_1',canonicalRaceId='20261011-JRA-TOKYO-01';
 return {sourceRaceId,canonicalRaceId,sourceSpreadsheetId:'synthetic-pdf-source',
 manifestTable:table([{Race_ID:sourceRaceId,'開催日':'2026-10-11','競馬場':'東京','レース番号':1,'芝ダ障':'ダート','距離':1600,'出走頭数':2}]),
 runnerTable:table([1,2].map(n=>({Race_ID:sourceRaceId,'開催日':'2026-10-11','競馬場':'東京',R:1,'馬番':n,'馬名':`馬${n}`,Horse_Key:`TEMP|馬${n}`,'取消状態':'UNKNOWN','斤量':'55.0','単勝オッズ':10,'人気':6}))),
 historyTable:table([1,2].flatMap(n=>[1,2,3,4,5].map(run=>({Race_ID:sourceRaceId,Horse_Key:`TEMP|馬${n}`,'馬番':n,'馬名':`馬${n}`,Run_No:run,'過去走日付':`2026-09-0${run}`,'競馬場':'新潟','クラス':'未勝利','頭数':15,'着順':4,'芝ダ':'ダート','距離':1600,'走破TIME':'1:42.0','上がり3F':38,'人気':3,'Raw_PDF':'private raw text'})))),
 associations:[1,2].map(n=>({sourceRaceId,canonicalRaceId,sourceHorseKey:`TEMP|馬${n}`,horseNo:n,horseName:`馬${n}`,canonicalHorseKey:`JRA|synthetic-${n}`,status:'PASS',evidenceRef:'synthetic/identity'})),
 statuses:[1,2].map(n=>({sourceRaceId,horseNo:n,horseName:`馬${n}`,status:'ACTIVE',evidenceRef:'synthetic/status'}))};
}
test('explicit PDF associations produce immutable-input, market-free bridge tables',()=>{
 const f=fixture(),before=structuredClone(f),out=adapt(f);assert.deepEqual(f,before);
 assert.equal(out.status,'READY_FOR_UNVERIFIED_RESEARCH_SNAPSHOT');assert.equal(out.joinedCount,2);
 assert.equal(out.history.length,11);assert.equal(out.formalKpiEligible,false);assert.equal(out.freezeMutation,'NONE');
 assert.ok(!JSON.stringify(out).includes('単勝オッズ'));assert.ok(!JSON.stringify(out).includes('人気'));assert.ok(!JSON.stringify(out).includes('private raw text'));
});
test('adapter integrates with existing research Snapshot bridge without promotion',async()=>{
 const out=adapt(fixture());const snapshot=await createPredictionEvidenceSnapshot({...out,raceId:out.canonicalRaceId,runId:'synthetic-run',modelVersion:'synthetic-v1',
 cutoffAt:'2026-10-11T00:00:00Z',offAt:'2026-10-11T01:05:00Z',source:{spreadsheetId:out.sourceSpreadsheetId,revision:'synthetic-r1',exportedAt:'2026-10-10T23:59:00Z',availableAt:'2026-10-10T23:58:00Z'}});
 assert.equal(snapshot.formalKpiEligible,false);assert.equal(snapshot.data.horses.length,2);
});
test('MM/DD retains raw date, excludes history, never guesses year',()=>{
 const f=fixture();set(f.historyTable,'過去走日付','08/02');const out=adapt(f);
 assert.equal(out.status,'HOLD');assert.equal(out.audit[0].pastRaceDate,null);assert.equal(out.audit[0].rawDate,'08/02');assert.equal(out.history.length,10);
 assert.ok(out.failures.some(r=>r.reason==='PDF_HISTORY_YEAR_UNCONFIRMED'));
});
test('UNKNOWN remains null and missing slot cannot become synthetic zero history',()=>{
 const f=fixture();set(f.historyTable,'過去走日付','UNKNOWN');set(f.runnerTable,'斤量','UNKNOWN');const out=adapt(f);
 assert.equal(out.runners[1][out.runners[0].indexOf('WeightCarried')],null);assert.ok(out.failures.some(r=>r.reason==='PDF_HISTORY_DATE_MISSING'));
 f.historyTable.pop();assert.throws(()=>adapt(f),/HISTORY_SLOT/);
});
test('temporary keys and unknown source status never become confirmed runners',()=>{
 const f=fixture();f.associations=[];f.statuses=[];const out=adapt(f);
 assert.equal(out.status,'HOLD');assert.equal(out.joinedCount,0);assert.equal(out.identityMap.length,0);assert.equal(out.history.length,1);
 assert.equal(out.failures.filter(r=>r.reason==='PDF_RUNNER_STATUS_UNCONFIRMED').length,2);
});
test('wrong race, key, name and number reject history joins',()=>{
 for(const [key,value] of [['Horse_Key','TEMP|other'],['馬名','other'],['馬番',3]]){const f=fixture();set(f.historyTable,key,value);assert.throws(()=>adapt(f),/HISTORY_IDENTITY/);}
 const f=fixture();set(f.historyTable,'Race_ID','other');assert.throws(()=>adapt(f),/HISTORY_SLOT/);
});
test('incomplete field, duplicate runner and conflicting race context reject',()=>{
 const f=fixture();f.runnerTable.pop();assert.throws(()=>adapt(f),/FIELD_INCOMPLETE/);
 const g=fixture();set(g.runnerTable,'馬番',1,2);assert.throws(()=>adapt(g),/RUNNER_DUPLICATE/);
 const h=fixture();set(h.runnerTable,'競馬場','京都');assert.throws(()=>adapt(h),/CONTEXT_CONFLICT/);
});
test('duplicate slot and current or future result reject',()=>{
 const f=fixture();set(f.historyTable,'Run_No',1,2);assert.throws(()=>adapt(f),/HISTORY_SLOT/);
 for(const value of ['2026-10-11','2026-10-12']){const g=fixture();set(g.historyTable,'過去走日付',value);assert.throws(()=>adapt(g),/CURRENT_OR_FUTURE/);}
});
test('invalid full calendar date holds rather than normalizing',()=>{
 const f=fixture();set(f.historyTable,'過去走日付','2026-02-30');assert.equal(adapt(f).audit[0].pastRaceDate,null);
});
test('ambiguous identities and reused canonical key cannot pass',()=>{
 const f=fixture();f.associations.push({...f.associations[0]});assert.equal(adapt(f).joinedCount,1);
 const g=fixture();g.associations[1].canonicalHorseKey=g.associations[0].canonicalHorseKey;assert.throws(()=>adapt(g),/KEY_REUSED/);
 const h=fixture();h.associations[0].canonicalHorseKey='TEMP|still-temp';assert.equal(adapt(h).joinedCount,1);
});
test('duplicate headers, non-scalar cells and unbounded tables reject',()=>{
 const f=fixture();f.runnerTable[0].push('馬名');assert.throws(()=>adapt(f),/TABLE_INVALID/);
 const g=fixture();set(g.historyTable,'馬名',{});assert.throws(()=>adapt(g),/TABLE_INVALID/);
 const h=fixture();h.historyTable=Array.from({length:5002},()=>h.historyTable[0]);assert.throws(()=>adapt(h),/TABLE_INVALID/);
});
test('exact source row references survive bounded sliced exports',()=>{
 const out=adapt({...fixture(),manifestStartRow:10,runnerStartRow:100,historyStartRow:200});
 assert.equal(out.refs[0].row,10);assert.equal(out.refs[1].row,100);assert.equal(out.audit[0].refs[0].row,200);
});
