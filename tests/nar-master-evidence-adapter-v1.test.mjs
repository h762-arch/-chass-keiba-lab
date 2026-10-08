import test from 'node:test';
import assert from 'node:assert/strict';
import {adaptNarMasterEvidence} from '../src/research/nar-master-evidence-adapter-v1.mjs';
const table=objects=>{const keys=[...new Set(objects.flatMap(Object.keys))];return [keys,...objects.map(o=>keys.map(k=>o[k]??null))];};
function fixture(){const sourceRaceId='20260914_OOI_12',canonicalRaceId='20260914-NAR-OI-12';return {sourceRaceId,canonicalRaceId,
 indexTable:table([1,2].map(no=>({'レースID':sourceRaceId,'開催日':46279,'主催':'NAR','競馬場':'大井',R:12,'芝/ダ':'ダ','距離m':1600,'馬番':no,'馬名':`馬${no}`,'最高指数':no*25,'5走平均':'10*','距離指数':'末','コース指数':30,'斤量':56,'予想オッズ':2,'人気':1}))),
 historyTable:table([1,2].map(no=>({'レースID':sourceRaceId,'馬番':no,'馬ID':`OP-${no}`,'馬名':`馬${no}`,'走順':1,'過去開催日':'2026-09-01','過去競馬場':'大井','芝/ダ':'ダ','距離m':1600,'着順':no,'走破TIME':'1:42.0','上がり3F':38,'人気':1}))),
 statuses:[1,2].map(no=>({sourceRaceId,horseNo:no,horseName:`馬${no}`,status:'ACTIVE',evidenceRef:'synthetic/status'}))};}
const set=(t,k,v,row=1)=>t[row][t[0].indexOf(k)]=v;
test('exact archival join preserves namespaced IDs and read-only inputs',()=>{
 const f=fixture(),before=structuredClone(f),out=adaptNarMasterEvidence(f);assert.deepEqual(f,before);
 assert.equal(out.joinedCount,2);assert.equal(out.context.date,'2026-09-14');assert.equal(out.status,'READY_FOR_UNVERIFIED_RESEARCH_SNAPSHOT');assert.equal(out.formalKpiEligible,false);
 assert.equal(out.identityMap[0].horseKey,'NAR_ARCHIVE|OP-1');
});
test('annotated and missing index values stay null; market is excluded',()=>{
 const out=adaptNarMasterEvidence(fixture()),row=Object.fromEntries(out.runners[0].map((k,i)=>[k,out.runners[1][i]]));
 assert.equal(row.Avg5Index,null);assert.equal(row.DistanceIndex,null);assert.equal(JSON.stringify(out.runners).includes('予想オッズ'),false);assert.equal(JSON.stringify(out.history).includes('人気'),false);
});
test('name mismatch holds identity rather than guessing from horse number',()=>{
 const f=fixture();set(f.historyTable,'馬名','別名');const out=adaptNarMasterEvidence(f);
 assert.equal(out.status,'HOLD');assert.equal(out.joinedCount,1);assert.ok(out.failures.some(f=>f.reason==='JOIN_NAME_CONFLICT'));
 assert.equal(out.history.length,2);
});
test('alias needs exact source race/name/id and evidence association',()=>{
 const f=fixture();set(f.historyTable,'馬名','別名');f.associations=[{sourceRaceId:f.sourceRaceId,canonicalRaceId:f.canonicalRaceId,horseNo:1,indexName:'馬1',historyName:'別名',sourceHorseId:'OP-1',status:'PASS',evidenceRef:'synthetic/alias'}];
 assert.equal(adaptNarMasterEvidence(f).joinedCount,2);f.associations[0].sourceHorseId='WRONG';assert.equal(adaptNarMasterEvidence(f).joinedCount,1);
});
test('missing starter status never becomes ACTIVE',()=>{
 const f=fixture();delete f.statuses;const out=adaptNarMasterEvidence(f);
 assert.equal(out.status,'HOLD');assert.equal(out.failures.filter(f=>f.reason==='RUNNER_STATUS_UNCONFIRMED').length,2);
});
test('source race mismatch cannot attach unrelated past runs',()=>{
 const f=fixture();set(f.historyTable,'レースID','OTHER');assert.ok(adaptNarMasterEvidence(f).failures.some(f=>f.reason==='HISTORY_IDENTITY_MISSING'));
});
test('duplicate history slot and current-race result reject',()=>{
 const f=fixture();f.historyTable.push(structuredClone(f.historyTable[1]));assert.throws(()=>adaptNarMasterEvidence(f),/DUPLICATE/);
 const g=fixture();set(g.historyTable,'過去開催日','2026-09-14');assert.throws(()=>adaptNarMasterEvidence(g),/CURRENT_OR_FUTURE/);
});
test('same identity used for different runners cannot pass',()=>{
 const f=fixture();set(f.historyTable,'馬ID','OP-1',2);assert.throws(()=>adaptNarMasterEvidence(f),/REUSED/);
});
