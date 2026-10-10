import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,writeFileSync,readFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stableHash } from '../src/prediction/precomputed-snapshot.mjs';
import { readSignalSourceBindingCohort,SIGNAL_BINDING_READ_SQL } from '../src/research/signal-source-binding-reader.mjs';
import { runSignalSourceBindingCli,signalSourceBindingExitCode } from '../scripts/audit-signal-source-bindings.mjs';

const raceId='20261010-JRA-東京-01',modelVersion='saved-model',at='2026-10-10T00:00:00Z';
async function fixture(){
 const scope={runId:'run',raceId,freezeId:'freeze',sourceSnapshotId:'source'};
 const snapshot={schemaVersion:1,policyVersion:'CHASS-SIGNAL-v1.0',status:'frozen',frozenAt:at,
  horses:[{horseNo:1,popularityAtFreeze:1,oddsAtFreeze:2,evAtFreeze:120,
   abilityMarkAtFreeze:'',finalMarkAtFreeze:'',warningMark:'⚠️',valueMark:'',
   warningScenario:{policyVersion:'CHASS-SIGNAL-v1.0',targetBasis:'market_top3',scenario:'4着以下',
    factors:[{code:'PACE_COLLAPSE',label:'展開不利'}]}}]};
 const evidence=['pace','condition'].map((group,i)=>({...scope,horseNo:1,evidenceId:`e${i}`,
  sourceRef:`s${i}`,independenceGroup:group,family:group.toUpperCase(),description:'確認済み根拠',
  direction:'NEGATIVE',eligibility:'ELIGIBLE',resolution:'RESOLVED',conflict:false,
  strength:'STRONG',stage:'EARLY',capturedAt:at}));
 const sources=evidence.map((e,i)=>({...scope,horseNo:1,sourceRef:e.sourceRef,
  originId:`episode-${i}`,independenceGroup:e.independenceGroup,family:e.family,
  stage:'EARLY',capturedAt:at,dataAsOf:at,payload:{observation:i}}));
 const survivalReviews=[{...scope,horseNo:1,reviewedAt:at,decision:'CLEAR',reason:'生存経路確認',evidenceIds:['e0','e1']}];
 const capture={scope,snapshot,evidence,sources,survivalReviews,storage:{raceId,modelVersion},
  manifest:{...scope,schemaVersion:1,immutableStatus:'FROZEN',frozenAt:at,offAt:'2026-10-10T01:00:00Z'}};
 const selection={raceId,modelVersion,capture},saved={race_id:raceId,model_version:modelVersion,
  market_json:JSON.stringify({raceId,signalSnapshot:snapshot,oddsHistory:[{ignored:true}]})};
 const reseal=async()=>{
  for(const s of sources)s.payloadHash=await stableHash(s.payload);
  for(const [field,v] of [['snapshotHash',snapshot],['evidenceHash',evidence],
   ['survivalReviewsHash',survivalReviews],['sourcesHash',sources]])capture.manifest[field]=await stableHash(v);
 };
 await reseal();const calls=[];
 const DB={prepare(sql){assert.equal(sql,SIGNAL_BINDING_READ_SQL);assert.ok(!/RESULT|INSERT|UPDATE|CREATE/i.test(sql));
  return {bind(...args){calls.push({sql,args});return {async first(){return saved;}}}};}};
 return {DB,selection,saved,capture,calls,reseal,run:()=>readSignalSourceBindingCohort({DB,selections:[selection]})};
}
test('exact saved Original Signal joins pinned receipts with SELECT only',async()=>{
 const f=await fixture(),before=JSON.stringify([f.selection,f.saved]),out=await f.run();
 assert.equal(out.status,'OBSERVED');assert.equal(out.rows[0].status,'STRUCTURAL_PASS');
 assert.equal(out.readQueryCount,1);assert.deepEqual(f.calls[0].args,[raceId,modelVersion]);
 assert.equal(out.authenticity,'NOT_VERIFIED');assert.equal(out.formalKpiEligible,false);
 assert.equal(out.productionActivationReady,false);assert.equal(JSON.stringify([f.selection,f.saved]),before);
 assert.ok(Object.isFrozen(out.rows[0].audit));
});
test('old saved signals without capture return a reason instead of minting a manifest',async()=>{
 const f=await fixture();delete f.selection.capture;const out=await f.run();
 assert.equal(out.rows[0].reason,'BINDING_CAPTURE_MISSING');assert.equal(out.rows[0].status,'UNVERIFIED');
});
test('missing row and missing signal remain separate from missing receipts',async()=>{
 const f=await fixture();const DB={prepare(){return {bind(){return {first:async()=>null}}}}};
 assert.equal((await readSignalSourceBindingCohort({DB,selections:[f.selection]})).rows[0].reason,'SAVED_RACE_MISSING');
 f.saved.market_json=null;assert.equal((await f.run()).rows[0].reason,'SIGNAL_SNAPSHOT_MISSING');
});
test('saved row and market wrapper race identity mismatch reject',async()=>{
 const f=await fixture();f.saved.model_version='other';assert.equal((await f.run()).rows[0].reason,'SAVED_IDENTITY_MISMATCH');
 const other=await fixture();other.saved.market_json=JSON.stringify({raceId:'other',signalSnapshot:other.capture.snapshot});
 assert.equal((await other.run()).rows[0].reason,'SIGNAL_RACE_IDENTITY_MISMATCH');
});
test('malformed saved market is rejected and provisional signal is not promoted',async()=>{
 const f=await fixture();f.saved.market_json='{';assert.equal((await f.run()).rows[0].reason,'SAVED_MARKET_INVALID');
 f.saved.market_json=JSON.stringify({signalSnapshot:{status:'provisional'}});
 assert.equal((await f.run()).rows[0].reason,'SIGNAL_NOT_FROZEN');
});
test('model and race selection bind supplied storage receipt',async()=>{
 for(const key of ['raceId','modelVersion']){
  const f=await fixture();f.capture.storage[key]='other';
  assert.equal((await f.run()).rows[0].reason,'CAPTURE_STORAGE_IDENTITY_MISMATCH');
 }
});
test('edited DB signal cannot be excused by current market values',async()=>{
 const f=await fixture();const market=JSON.parse(f.saved.market_json);
 market.signalSnapshot.horses[0].popularityAtFreeze=4;market.odds=2;f.saved.market_json=JSON.stringify(market);
 assert.equal((await f.run()).rows[0].reason,'SAVED_SIGNAL_CAPTURE_MISMATCH');
});
test('later odds outside saved Original Signal are not used as evidence',async()=>{
 const f=await fixture();const market=JSON.parse(f.saved.market_json);
 market.oddsHistory=[{stage:'RESULT',odds:999,popularity:4}];f.saved.market_json=JSON.stringify(market);
 assert.equal((await f.run()).rows[0].status,'STRUCTURAL_PASS');
});
test('Phase111 payload mismatch remains a rejection through the reader',async()=>{
 const f=await fixture();f.capture.sources[0].payload.observation=99;
 f.capture.manifest.sourcesHash=await stableHash(f.capture.sources);
 assert.equal((await f.run()).rows[0].reason,'SOURCE_PAYLOAD_MISMATCH');
});
test('bound survival violation is not reported as a successful Signal audit',async()=>{
 const f=await fixture();f.capture.survivalReviews[0].decision='VETO';await f.reseal();
 const out=await f.run();assert.equal(out.rows[0].status,'VIOLATION');
 assert.equal(out.reasonCounts.SIGNAL_RULE_VIOLATION,1);assert.equal(signalSourceBindingExitCode(out),2);
});
test('bound content with insufficient independent evidence stays unverified',async()=>{
 const f=await fixture();f.capture.evidence[1].direction='UNKNOWN';await f.reseal();
 const out=await f.run();assert.equal(out.rows[0].status,'UNVERIFIED');assert.equal(signalSourceBindingExitCode(out),3);
});
test('D1 failures are BLOCKED and sensitive exceptions are not exposed',async()=>{
 const f=await fixture();const DB={prepare(){throw Error('private database URL');}};
 const out=await readSignalSourceBindingCohort({DB,selections:[f.selection]});
 assert.equal(out.reason,'D1_READ_FAILED');assert.equal(out.readQueryCount,1);
 assert.ok(!JSON.stringify(out).includes('private'));
});
test('duplicates and missing model versions reject before any D1 read',async()=>{
 const f=await fixture();assert.equal((await readSignalSourceBindingCohort({DB:f.DB,selections:[f.selection,f.selection]})).reason,'DUPLICATE_SELECTION');
 delete f.selection.modelVersion;assert.equal((await f.run()).reason,'INVALID_SELECTIONS');assert.equal(f.calls.length,0);
});
test('multiple models of one race remain distinct selections',async()=>{
 const f=await fixture(),other={raceId,modelVersion:'older'};const DB={prepare(){return {bind(_race,model){return {first:async()=>model==='older'?null:f.saved}}}}};
 const out=await readSignalSourceBindingCohort({DB,selections:[f.selection,other]});
 assert.equal(out.rows.length,2);assert.equal(out.readQueryCount,2);
 assert.equal(out.rows.filter(r=>r.reason==='SAVED_RACE_MISSING').length,1);
});
test('offline CLI reads selected exports and leaves input files unchanged',async()=>{
 const f=await fixture(),dir=mkdtempSync(join(tmpdir(),'chass-binding-'));
 try{
  const rows=join(dir,'rows.json'),selections=join(dir,'selections.json');
  const a=JSON.stringify([f.saved]),b=JSON.stringify([f.selection]);writeFileSync(rows,a);writeFileSync(selections,b);
  const out=await runSignalSourceBindingCli(['--rows',rows,'--selections',selections]);
  assert.equal(signalSourceBindingExitCode(out),0);assert.equal(out.formalKpiEligible,false);
  assert.equal(readFileSync(rows,'utf8'),a);assert.equal(readFileSync(selections,'utf8'),b);
  writeFileSync(rows,JSON.stringify([f.saved,f.saved]));
  assert.equal((await runSignalSourceBindingCli(['--rows',rows,'--selections',selections])).reason,'CAPTURE_FILE_READ_FAILED');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('CLI forbids remote/apply arguments and returns explicit failure codes',async()=>{
 assert.equal((await runSignalSourceBindingCli(['--remote'])).reason,'INVALID_CLI_ARGUMENTS');
 assert.equal(signalSourceBindingExitCode({status:'BLOCKED'}),1);
 assert.equal(signalSourceBindingExitCode({status:'OBSERVED',rows:[{status:'REJECTED'}]}),2);
});
test('a frozen label without a valid saved Signal does not hide behind missing capture',async()=>{
 const f=await fixture();delete f.selection.capture;
 f.saved.market_json=JSON.stringify({signalSnapshot:{status:'frozen'}});
 assert.equal((await f.run()).rows[0].reason,'SAVED_SIGNAL_INVALID');
});
