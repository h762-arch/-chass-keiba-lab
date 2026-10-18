import assert from 'node:assert/strict';
import {d1Fingerprint} from '../../worker.js';
import {captureNarInitialResearchBundle} from '../../src/research/nar-initial-research-bundle.mjs';
import {saveNarCommitObservationResearch} from '../../src/research/nar-commit-admission.mjs';
// Synthetic ORIGINAL inputs created before sealing, never repairs to saved data.
export const raceId='2026-10-07|園田|7',at='2026-10-07T03:00:00.000Z',tick=Date.parse(at),now=Date.parse('2026-10-07T06:00:00Z');
export async function fixture(change=()=>{},observation={outcome:'RESOLVED',startedAt:tick,returnedAt:tick}){
 const race={raceDate:'2026-10-07',track:'園田',raceNo:7,raceType:'NAR',postTime:'13:50',narSourceAcquiredAt:at};
 const horses=Array.from({length:9},(_,i)=>({horseNo:i+1,horseName:`合成馬${i+1}`,win:i?10:20,place:i?30:60,
  runningStyle:'先行・好位',predictedTime:'1:33.5',predictedTimeConfidence:90,features:{distanceFit:90,courseFit:88,evidence:{sameDistance:2,sameTrack:2}}}));
 const predictionSnapshot={modelVersion:'10.0.1',race,createdAt:at,generatedAt:at,horses};
 const marketSnapshot={createdAt:at,acquiredAt:at,horses:horses.map(h=>({horseNo:h.horseNo})),signalSnapshot:{status:'frozen',horses:horses.map(h=>({horseNo:h.horseNo,popularityAtFreeze:h.horseNo,oddsAtFreeze:30,valueMark:'',warningMark:''}))}};
 const finalSnapshot={createdAt:at,generatedAt:at,top3:[{horseNo:1}]};
 const record={race,predictionSnapshot,marketSnapshot,finalSnapshot};change(record);
 record.snapshotIntegrity={algorithm:'FNV-1a-32/canonical-json',sealedAt:at,hashes:Object.fromEntries(Object.entries({predictionSnapshot,marketSnapshot,finalSnapshot}).map(([k,v])=>[k,d1Fingerprint(v)]))};
 const rows=new Map(),store={async get(k){return rows.get(k)??null;},async insertBundleIfBothAbsent(legacy,k,raw){if(rows.has(legacy)||rows.has(k))return false;rows.set(k,raw);return true;}};
 const captured=await captureNarInitialResearchBundle({enabled:true,store,raceId,clock:()=>tick,acquire:async()=>({record,acquiredAt:at,acquisitionKind:'fresh'})});
 assert.equal(captured.status,'CREATED',JSON.stringify(captured));
 const receiptStore={async get(k){return rows.get(k)??null;},async insertIfAbsent(k,raw){if(rows.has(k))return false;rows.set(k,raw);return true;}};
 assert.equal((await saveNarCommitObservationResearch({enabled:true,snapshot:captured.snapshot,observation,receiptStore})).status,'CREATED');
 const fetchedAt='2026-10-07T05:00:00Z',actual=horses.map((h,i)=>({horseNo:h.horseNo,horseName:h.horseName,position:i+1,positionText:String(i+1),horseStatus:'active',eligible:true,time:`1:34.${i}`}));
 const result={schemaVersion:3,raceId,organization:'NAR',resultSource:'NAR_OFFICIAL',fetchedAt,finishOrder:[1,2,3],horses:actual,actualTimes:Object.fromEntries(actual.map(h=>[h.horseNo,h.time]))};
 const f={rows,result,row:{race_id:raceId,model_version:'10.0.1',result_acquired_at:fetchedAt},calls:[]};
 f.DB={prepare(sql){assert.match(sql,/^SELECT\b/);assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|PRAGMA)\b/i);const call={sql,args:[]};f.calls.push(call);
  return {bind(...args){call.args=args;return this;},async first(){
   if(sql.includes('FROM races '))return f.row===null?null:{...f.row,result_json:f.row.result_json!==undefined?f.row.result_json:JSON.stringify(f.result)};
   const raw=rows.get(call.args[0]);if(sql.startsWith('SELECT 1 '))return raw===undefined?null:{present:1};
   return raw===undefined?null:{raw};
  }};
 }};
 return f;
}
