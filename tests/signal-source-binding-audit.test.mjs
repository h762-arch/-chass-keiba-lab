import test from 'node:test';
import assert from 'node:assert/strict';
import { stableHash } from '../src/prediction/precomputed-snapshot.mjs';
import { auditSignalSourceBindings } from '../src/research/signal-source-binding-audit.mjs';

const at='2026-10-10T00:00:00.000Z';
async function seal(input){
 for(const source of input.sources)source.payloadHash=await stableHash(source.payload);
 for(const [field,value] of [['snapshotHash',input.snapshot],['evidenceHash',input.evidence],
  ['survivalReviewsHash',input.survivalReviews],['sourcesHash',input.sources]])
  input.manifest[field]=await stableHash(value);
 return input;
}
async function fixture(){
 const scope={runId:'run',raceId:'race',freezeId:'freeze',sourceSnapshotId:'source'};
 const snapshot={schemaVersion:1,policyVersion:'CHASS-SIGNAL-v1.0',status:'frozen',frozenAt:at,
  horses:[{horseNo:1,popularityAtFreeze:1,oddsAtFreeze:2,evAtFreeze:120,
   abilityMarkAtFreeze:'',finalMarkAtFreeze:'',warningMark:'⚠️',valueMark:'',
   warningScenario:{policyVersion:'CHASS-SIGNAL-v1.0',targetBasis:'market_top3',scenario:'4着以下',
    factors:[{code:'PACE_COLLAPSE',label:'展開不利'},{code:'DISTANCE_RISK',label:'距離不利'}]}}]};
 const evidence=['pace','condition'].map((group,i)=>({...scope,horseNo:1,evidenceId:`e${i}`,
  sourceRef:`s${i}`,independenceGroup:group,family:group.toUpperCase(),description:'確認済み根拠',
  direction:'NEGATIVE',eligibility:'ELIGIBLE',resolution:'RESOLVED',conflict:false,
  strength:'STRONG',stage:'EARLY',capturedAt:at}));
 const sources=evidence.map((e,i)=>({...scope,horseNo:1,sourceRef:e.sourceRef,
  originId:`episode-${i}`,independenceGroup:e.independenceGroup,family:e.family,
  stage:'EARLY',capturedAt:at,dataAsOf:at,payload:{observation:i,description:'事前観測'}}));
 const survivalReviews=[{...scope,horseNo:1,reviewedAt:at,decision:'CLEAR',
  reason:'生存経路と比較済み',evidenceIds:['e0','e1']}];
 return seal({scope,snapshot,evidence,sources,survivalReviews,
  manifest:{...scope,schemaVersion:1,immutableStatus:'FROZEN',frozenAt:at,offAt:'2026-10-10T01:00:00.000Z'}});
}
test('matching captured content stays research-only and inputs remain unchanged',async()=>{
 const input=await fixture(),before=JSON.stringify(input),out=await auditSignalSourceBindings(input);
 assert.equal(out.status,'READY');assert.equal(out.lineageStatus,'CONTENT_BOUND');
 assert.equal(out.audit.rows[0].status,'STRUCTURAL_PASS');assert.equal(out.authenticity,'NOT_VERIFIED');
 assert.equal(out.adopted,false);assert.equal(out.formalKpiEligible,false);
 assert.equal(out.productionActivationReady,false);assert.equal(JSON.stringify(input),before);
 assert.ok(Object.isFrozen(out.audit.rows[0].reasons));
});
test('snapshot, evidence, survival and source registry edits invalidate manifest',async()=>{
 for(const key of ['snapshot','evidence','survivalReviews','sources']){
  const input=await fixture();if(key==='snapshot')input.snapshot.horses[0].oddsAtFreeze=4;
  else input[key][0].extra='edit';
  assert.equal((await auditSignalSourceBindings(input)).reason,'MANIFEST_CONTENT_MISMATCH');
 }
});
test('raw source payload edits fail even when the outer registry hash is recomputed',async()=>{
 const input=await fixture();input.sources[0].payload.observation=99;
 input.manifest.sourcesHash=await stableHash(input.sources);
 assert.equal((await auditSignalSourceBindings(input)).reason,'SOURCE_PAYLOAD_MISMATCH');
});
test('same episode cannot claim two independence groups',async()=>{
 const input=await fixture();input.sources[1].originId=input.sources[0].originId;await seal(input);
 assert.equal((await auditSignalSourceBindings(input)).reason,'SOURCE_ORIGIN_GROUP_CONFLICT');
});
test('same source episode with multiple derived rows counts as one group',async()=>{
 const input=await fixture();input.sources[1].originId=input.sources[0].originId;
 input.sources[1].independenceGroup='pace';input.evidence[1].independenceGroup='pace';await seal(input);
 const out=await auditSignalSourceBindings(input);
 assert.equal(out.status,'READY');assert.equal(out.audit.rows[0].negativeGroupCount,1);
 assert.equal(out.audit.rows[0].status,'UNVERIFIED');
});
test('cross-run and cross-race sources reject despite recomputed hashes',async()=>{
 for(const key of ['runId','raceId','freezeId','sourceSnapshotId']){
  const input=await fixture();input.sources[0][key]='other';await seal(input);
  assert.equal((await auditSignalSourceBindings(input)).reason,'INVALID_SOURCE_RECEIPT');
 }
});
test('source horse, family and independence group must match evidence',async()=>{
 for(const [key,value] of [['horseNo',2],['family','MARKET'],['independenceGroup','other']]){
  const input=await fixture();input.sources[0][key]=value;await seal(input);
  assert.equal((await auditSignalSourceBindings(input)).status,'REJECTED');
 }
});
test('missing known source remains unverified',async()=>{
 const input=await fixture();input.sources.pop();await seal(input);
 assert.equal((await auditSignalSourceBindings(input)).reason,'EVIDENCE_SOURCE_UNAVAILABLE');
});
test('missing source is not invented for UNKNOWN or exhausted evidence',async()=>{
 const input=await fixture();input.evidence[1].direction='UNKNOWN';
 input.evidence[1].resolution='SOURCE_MISSING';input.sources.pop();await seal(input);
 const out=await auditSignalSourceBindings(input);
 assert.equal(out.status,'READY');assert.equal(out.audit.rows[0].status,'UNVERIFIED');
});
test('future source and result-stage source reject',async()=>{
 for(const change of [{dataAsOf:'2026-10-10T00:00:01.000Z'},
  {capturedAt:'2026-10-10T00:00:01.000Z'},{stage:'POST'},{stage:'LIVE'}]){
  const input=await fixture();Object.assign(input.sources[0],change);await seal(input);
  assert.equal((await auditSignalSourceBindings(input)).reason,'INVALID_SOURCE_RECEIPT');
 }
});
test('source must be captured before evidence interpretation',async()=>{
 const input=await fixture();input.evidence[0].capturedAt='2026-10-09T23:59:59.000Z';await seal(input);
 assert.equal((await auditSignalSourceBindings(input)).reason,'EVIDENCE_SOURCE_BINDING_MISMATCH');
});
test('Freeze at post time, mismatched Freeze and unfrozen manifest reject',async()=>{
 for(const change of [{offAt:at},{frozenAt:'2026-10-09T23:59:59.000Z'},{immutableStatus:'OPEN'}]){
  const input=await fixture();Object.assign(input.manifest,change);
  assert.equal((await auditSignalSourceBindings(input)).reason,'INVALID_BINDING_MANIFEST');
 }
});
test('duplicate source keys and malformed hashes reject',async()=>{
 const input=await fixture();input.sources[1].sourceRef='s0';await seal(input);
 assert.equal((await auditSignalSourceBindings(input)).reason,'INVALID_SOURCE_RECEIPT');
 const other=await fixture();other.manifest.snapshotHash='not-a-hash';
 assert.equal((await auditSignalSourceBindings(other)).reason,'MANIFEST_HASH_REQUIRED');
});
test('non-JSON and unavailable crypto reject without throwing private details',async()=>{
 const input=await fixture();input.extra=NaN;
 assert.equal((await auditSignalSourceBindings(input)).reason,'INVALID_CAPTURED_JSON');
 const out=await auditSignalSourceBindings(await fixture(),{cryptoImpl:{}});
 assert.equal(out.reason,'HASH_UNAVAILABLE');
});
test('caller mutations during async hashing cannot change the audited capture',async()=>{
 const input=await fixture();const pending=auditSignalSourceBindings(input);
 input.evidence[0].direction='POSITIVE';input.snapshot.horses[0].warningMark='';
 const out=await pending;assert.equal(out.status,'READY');
 assert.equal(out.audit.rows[0].negativeGroupCount,2);
});
test('null roots, accessors and sparse arrays fail closed before hashing',async()=>{
 for(const input of [null,[],{get snapshot(){throw new Error('must not invoke');}},
  {evidence:new Array(2)}])
  assert.equal((await auditSignalSourceBindings(input)).reason,'INVALID_CAPTURED_JSON');
});
