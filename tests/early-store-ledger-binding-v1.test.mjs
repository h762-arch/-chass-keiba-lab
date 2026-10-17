import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {predictionKpiLedgerSha256 as hash,PREDICTION_KPI_LEDGER_VERSION as VERSION} from '../src/prediction/prediction-kpi-ledger-adapter-v2155.mjs';
import {createPrecomputedSnapshot} from '../src/prediction/precomputed-snapshot.mjs';
import {savePrecomputedSnapshot} from '../src/prediction/precomputed-store.mjs';
import {readEarlyStoreLedgerBindingV1 as read} from '../src/prediction/early-store-ledger-binding-v1.mjs';
const tiers=['T0_CACHE_REGISTRY','T1_CANONICAL_PROVIDER','T2_ALT_AUTHORITATIVE','T3_PRE_CUTOFF_BUILD'];
const body=(x,k)=>x.bundle.sections.find(s=>s.kind===k).body;
async function reseal(x){for(const s of x.bundle.sections)s.contentSha256=await hash(s.body);x.anchor.bundleSha256=await hash(x.bundle);return x}
async function ledgerFixture(){
  const runnerKeys=['h1','h2','h3','h4','h5','h6'],final5Keys=runnerKeys.slice(0,5),rolePairs=[];
  for(let i=0;i<5;i++)for(let j=i+1;j<5;j++)rolePairs.push({horseKeys:[final5Keys[i],final5Keys[j]],status:'PASS'});
  const gates=['officialCard','identity','sourceFrozen','sourceLineage','leakageGuard','candidateTrace','portfolio','preservation','roleTournament','signalEvidence','productionWritePolicy','baselineReadiness','fieldEligibilityProof'];
  const core={runId:'run1',raceId:'race1',freezeId:'prediction-frz1',snapshotHash:'external-prediction-content',fieldEligibilityFreezeId:'field-frz1',acquisitionFreezeId:'acq-frz1',contractFreezeId:'contract-frz1',frozenAt:'2026-10-09T09:00:00Z',offAt:'2026-10-09T10:00:00Z',mode:'FORWARD',stage:'ORIGINAL_EARLY',immutableStatus:'FROZEN',resultPresent:false,cancelled:false,postFreezeMutation:false,gates:Object.fromEntries(gates.map(k=>[k,'PASS'])),runnerKeys,final5Keys,rolePairs};
  const plan={eligibilityId:'el1',fieldId:'E_POSITION_PACE',scopeKey:'h1',requirementSnapshotId:'req1',eligibilityStatus:'ELIGIBLE',acquisitionRequired:'MUST_ACQUIRE',numericMetric:true,structuralMissing:false};
  const contract={version:'v2.15.5',baselineReadinessVersion:'CONTRACT_V04',freezeId:'contract-frz1',sourceSnapshotId:'contract-source1',frozenAt:'2026-10-09T07:00:00Z',fields:[plan]};
  const field={...plan,runId:'run1',raceId:'race1',contractFreezeId:'contract-frz1',freezeId:'field-frz1',acquisitionFreezeId:'acq-frz1',frozenAt:'2026-10-09T08:50:00Z',immutableStatus:'FROZEN',leakageGuard:'PASS',sourceLineage:'PASS',conflict:false,acquisitionState:'RESOLVED',resolutionStatus:'RESOLVED',value:0,sourceSnapshotId:'source1',sourceStage:'EARLY'};
  const attempt={attemptId:'a1',eligibilityId:'el1',fieldId:plan.fieldId,scopeKey:'h1',runId:'run1',raceId:'race1',attemptNo:1,tier:tiers[0],provider:'canonical-cache',sourceCandidate:'pre-result-cache',attemptedAt:'2026-10-09T08:00:00Z',result:'FOUND',sourceSnapshotId:'source1',leakageGuard:'PASS',immutableStatus:'FROZEN'};
  const source=(id,time,values)=>({sourceSnapshotId:id,runId:'run1',raceId:'race1',stage:'EARLY',capturedAt:time,dataAsOf:time,identityStatus:'PASS',sourceLineage:'PASS',leakageGuard:'PASS',immutableStatus:'FROZEN',values});
  const sources=[source('contract-source1','2026-10-09T06:30:00Z',[]),source('req1','2026-10-09T06:30:00Z',[]),source('source1','2026-10-09T07:50:00Z',[{eligibilityId:'el1',fieldId:plan.fieldId,scopeKey:'h1',value:0}])];
  const section=(kind,snapshotId,frozenAt,b)=>({kind,snapshotId,runId:'run1',raceId:'race1',frozenAt,immutableStatus:'FROZEN',body:b,contentSha256:''});
  const bundle={schemaVersion:VERSION,runId:'run1',raceId:'race1',predictionFreezeId:'prediction-frz1',immutableStatus:'FROZEN',sections:[section('contract','contract-frz1',contract.frozenAt,contract),section('core','prediction-frz1',core.frozenAt,core),section('fields','field-frz1',field.frozenAt,[field]),section('attempts','acq-frz1',field.frozenAt,[attempt]),section('sources','source-frz1',field.frozenAt,sources)]};
  return reseal({bundle,anchor:{schemaVersion:'VERIFIED_PREDICTION_KPI_INPUT_ANCHOR_V1',runId:'run1',raceId:'race1',predictionFreezeId:'prediction-frz1',bundleSha256:'',evidenceRef:'independent-test-anchor'}});
}
function database(){const db=new DatabaseSync(':memory:'),calls=[];db.exec(readFileSync(new URL('../migrations/0012_precomputed_snapshots.sql',import.meta.url),'utf8'));return {db,calls,prepare(sql){calls.push(sql);let args;return {bind(...x){args=x;return this;},async first(){return db.prepare(sql).get(...args)||null;},async run(){return db.prepare(sql).run(...args);}};},close(){db.close();}};}
async function fixture(organization='JRA'){
 const DB=database(),x=await ledgerFixture();
 const snapshot=await createPrecomputedSnapshot({organization,raceId:'race1',source:{acquiredAt:'2026-10-09T08:54:00Z'},data:{ability:80},now:'2026-10-09T08:55:00Z'});
 await savePrecomputedSnapshot(DB,snapshot);DB.calls.length=0;
 const saveRecord={schemaVersion:'CHASS_EARLY_SAVE_RECORD_V1',recordId:'synthetic-record',organization,raceId:'race1',revision:1,sourceHash:snapshot.sourceHash,inputHash:snapshot.inputHash,snapshotHash:snapshot.snapshotHash,runId:x.bundle.runId,freezeId:x.bundle.predictionFreezeId,savedAt:'2026-10-09T08:56:00Z'};
 const evidence={saveRecord,ledgerBundle:x.bundle,ledgerAnchor:x.anchor};
 const pin={schemaVersion:'CHASS_EARLY_STORE_LEDGER_PIN_V1',organization,raceId:'race1',revision:1,snapshotHash:snapshot.snapshotHash,runId:x.bundle.runId,freezeId:x.bundle.predictionFreezeId,saveRecordSha256:await hash(saveRecord),ledgerBundleSha256:x.anchor.bundleSha256};
 return {DB,evidence,pin,snapshot};
}
async function repin(x){const ledger=await reseal({bundle:x.evidence.ledgerBundle,anchor:x.evidence.ledgerAnchor});x.pin.saveRecordSha256=await hash(x.evidence.saveRecord);x.pin.ledgerBundleSha256=ledger.anchor.bundleSha256;}
const check=x=>read(x.DB,JSON.stringify(x.evidence),JSON.stringify(x.pin));
function safe(r){assert.equal(r.formalReadiness,'HOLD');for(const k of ['formalKpiEligible','persistenceVerified','acquisitionCertified','earlyFreezeVerified','externalAnchorAuthenticated'])assert.equal(r[k],false);assert.equal(r.earlyImmutable,null);assert.equal(r.freezeMutation,'NONE');assert.equal(r.probabilityDecision,'MODEL_HOLD');assert.equal(r.productionActivationDecision,'NO-GO');assert.ok(Object.isFrozen(r));}
for(const org of ['JRA','NAR'])test(`${org} real SQLite read joins existing five-section ledger without mutation or promotion`,async()=>{const x=await fixture(org);try{const original=JSON.stringify(x.evidence),r=await check(x);assert.equal(r.status,'STORE_LEDGER_BINDINGS_MATCH');assert.equal(r.revision,1);assert.equal(x.DB.calls.length,1);assert.ok(x.DB.calls[0].startsWith('SELECT'));assert.equal(JSON.stringify(x.evidence),original);safe(r);}finally{x.DB.close();}});
test('newer saved snapshot never replaces pinned content',async()=>{const x=await fixture();try{
 const newer=await createPrecomputedSnapshot({organization:'JRA',raceId:'race1',source:{generation:2},data:{ability:90},now:'2026-10-09T09:01:00Z'});await savePrecomputedSnapshot(x.DB,newer);x.DB.calls.length=0;const r=await check(x);assert.equal(r.status,'STORE_LEDGER_BINDINGS_MATCH');assert.equal(r.snapshotHash,x.snapshot.snapshotHash);assert.equal(r.revision,1);assert.equal(x.DB.calls.length,1);
}finally{x.DB.close();}});
for(const [name,mutate,reason] of [
 ['record content',x=>x.evidence.saveRecord.recordId='changed','PINNED_CONTENT_MISMATCH'],
 ['ledger content',x=>x.evidence.ledgerBundle.runId='changed','PINNED_CONTENT_MISMATCH'],
 ['pin revision',x=>x.pin.revision=2,'SAVE_PIN_BINDING_MISMATCH'],
 ['pin organization',x=>x.pin.organization='NAR','SAVE_PIN_BINDING_MISMATCH'],
 ['pin race',x=>x.pin.raceId='other','SAVE_PIN_BINDING_MISMATCH'],
 ['pin snapshot',x=>x.pin.snapshotHash='c'.repeat(64),'SAVE_PIN_BINDING_MISMATCH'],
 ['pin run',x=>x.pin.runId='other','SAVE_PIN_BINDING_MISMATCH'],
 ['pin freeze',x=>x.pin.freezeId='other','SAVE_PIN_BINDING_MISMATCH'],
 ['ledger anchor',x=>x.evidence.ledgerAnchor.bundleSha256='c'.repeat(64),'LEDGER_SAVE_BINDING_MISMATCH']
])test(`${name} mismatch holds before DB access`,async()=>{const x=await fixture();try{mutate(x);const r=await check(x);assert.equal(r.reason,reason);assert.equal(x.DB.calls.length,0);safe(r);}finally{x.DB.close();}});
for(const [name,mutate,reason] of [
 ['other run',x=>{x.evidence.saveRecord.runId=x.pin.runId='other';},'LEDGER_SAVE_BINDING_MISMATCH'],
 ['other race',x=>{x.evidence.saveRecord.raceId=x.pin.raceId='other';},'LEDGER_SAVE_BINDING_MISMATCH'],
 ['other freeze',x=>{x.evidence.saveRecord.freezeId=x.pin.freezeId='other';},'LEDGER_SAVE_BINDING_MISMATCH'],
 ['late save',x=>x.evidence.saveRecord.savedAt='2026-10-09T09:00:01Z','SAVE_FREEZE_TIME_MISMATCH'],
 ['invalid calendar date',x=>x.evidence.saveRecord.savedAt='2026-02-30T08:56:00Z','SAVE_FREEZE_TIME_MISMATCH'],
 ['no timezone',x=>x.evidence.saveRecord.savedAt='2026-10-09T08:56:00','SAVE_FREEZE_TIME_MISMATCH'],
 ['policy HOLD',x=>x.evidence.ledgerBundle.sections.find(s=>s.kind==='core').body.gates.portfolio='HOLD','LEDGER_POLICY_HOLD'],
 ['post result',x=>x.evidence.ledgerBundle.sections.find(s=>s.kind==='core').body.resultPresent=true,'LEDGER_POLICY_HOLD'],
 ['live stage',x=>x.evidence.ledgerBundle.sections.find(s=>s.kind==='core').body.stage='FINAL','LEDGER_POLICY_HOLD'],
 ['missing section',x=>x.evidence.ledgerBundle.sections.pop(),'LEDGER_POLICY_HOLD'],
 ['nonpositive revision',x=>x.evidence.saveRecord.revision=0,'INVALID_SAVE_RECORD']
])test(`rehashing cannot hide ${name}`,async()=>{const x=await fixture();try{mutate(x);await repin(x);const r=await check(x);assert.equal(r.reason,reason);assert.equal(x.DB.calls.length,0);safe(r);}finally{x.DB.close();}});
test('save before DATA calculation holds after exact read',async()=>{const x=await fixture();try{x.evidence.saveRecord.savedAt='2026-10-09T08:54:30Z';await repin(x);const r=await check(x);assert.equal(r.reason,'SNAPSHOT_SAVE_TIME_MISMATCH');assert.equal(x.DB.calls.length,1);safe(r);}finally{x.DB.close();}});
test('missing revision holds without latest fallback',async()=>{const x=await fixture();try{x.evidence.saveRecord.revision=x.pin.revision=2;await repin(x);assert.equal((await check(x)).reason,'EXACT_REVISION_READBACK_HOLD');assert.equal(x.DB.calls.length,1);}finally{x.DB.close();}});
test('tampered stored DATA fails even when metadata and record agree',async()=>{const x=await fixture();try{x.DB.db.prepare('UPDATE precomputed_race_snapshots SET data_json=?').run('{"ability":999}');assert.equal((await check(x)).reason,'EXACT_REVISION_READBACK_HOLD');}finally{x.DB.close();}});
test('equal instants with timezone offsets are accepted',async()=>{const x=await fixture();try{x.evidence.saveRecord.savedAt='2026-10-09T17:56:00+09:00';await repin(x);assert.equal((await check(x)).status,'STORE_LEDGER_BINDINGS_MATCH');}finally{x.DB.close();}});
test('invalid and oversized inputs never invoke serialization callbacks or DB',async()=>{let calls=0;const DB={prepare(){calls++;throw Error();}},cb={toJSON(){calls++;throw Error();}};for(const raw of [null,cb,'{','null','[]','x'.repeat(500001),JSON.stringify({text:'馬'.repeat(170000)})]){const r=await read(DB,raw,'{}');assert.equal(r.reason,'INVALID_BINDING_INPUT');safe(r);}assert.equal(calls,0);});
test('self-authentication flags and matching caller pin never grant trust',async()=>{const x=await fixture();try{x.pin.authenticated=true;x.evidence.trusted=true;const r=await check(x);assert.equal(r.status,'STORE_LEDGER_BINDINGS_MATCH');safe(r);}finally{x.DB.close();}});
test('DB error is bounded and contains no private detail',async()=>{const x=await fixture();try{x.DB={prepare(){throw Error('PRIVATE_SECRET');},close:x.DB.close};const r=await check(x);assert.equal(r.reason,'EXACT_REVISION_READBACK_HOLD');assert.equal(JSON.stringify(r).includes('PRIVATE_SECRET'),false);safe(r);}finally{x.DB.close();}});
