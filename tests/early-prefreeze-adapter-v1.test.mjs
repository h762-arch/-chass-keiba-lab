import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {assessEarlyBeforeSaveV1 as before,assessEarlyAfterSaveV1 as after} from '../src/prediction/early-prefreeze-adapter-v1.mjs';
function declarations(){
 const freezeAt='2026-10-17T01:00:00Z';
 return {raceId:'synthetic-race',venue:'synthetic-venue',raceNo:1,startAt:'2026-10-17T02:00:00Z',freezeAt,expectedRunnerCount:2,
  runners:[1,2].map(n=>({horseNo:n,horseName:`synthetic-${n}`,canonicalId:`horse-${n}`,identitySource:'synthetic',identityVerified:true,capturedAt:'2026-10-17T00:00:00Z',sourceRef:'synthetic-source',evidenceId:`e-${n}`,evidenceSource:'synthetic',evidenceSavedAt:'2026-10-17T00:10:00Z',evidenceReadback:true})),
  snapshot:{id:'snapshot-1',hash:'a'.repeat(64),savedAt:'2026-10-17T00:20:00Z',readback:true},cpsi:{coverageVerified:true,modelReady:true},
  early:{freezeId:'freeze-1',signalHash:'b'.repeat(64),immutable:true,readback:true,freezeAt},readback:{snapshot:true,evidence:true,early:true}};
}
function bundle(change=()=>{}){
 const artifact={schemaVersion:'CHASS_EARLY_OFFLINE_EVIDENCE_V1',raceId:'synthetic-race',snapshotId:'snapshot-1',revision:3,freezeId:'freeze-1',signalHash:'b'.repeat(64),declarations:declarations()};
 change(artifact);const raw=JSON.stringify(artifact);
 const anchor={schemaVersion:'CHASS_EARLY_OFFLINE_ANCHOR_V1',raceId:artifact.raceId,snapshotId:artifact.snapshotId,revision:artifact.revision,freezeId:artifact.freezeId,signalHash:artifact.signalHash,artifactSha256:createHash('sha256').update(raw).digest('hex')};
 return {raw,anchor};
}
function safe(r){assert.equal(r.formalReadiness,'HOLD');assert.equal(r.formalKpiEligible,false);assert.equal(r.persistenceVerified,false);assert.equal(r.earlyFreezeVerified,false);assert.equal(r.acquisitionCertified,false);assert.equal(r.externalAnchorAuthenticated,false);assert.equal(r.earlyImmutable,null);assert.equal(r.probabilityDecision,'MODEL_HOLD');assert.equal(r.productionActivationDecision,'NO-GO');}
test('pre-save needs no future freeze or save receipt and never authorizes production',()=>{
 const x=declarations();delete x.snapshot;delete x.early;delete x.readback;
 for(const r of x.runners){delete r.evidenceId;delete r.evidenceSavedAt;delete r.evidenceReadback;}
 const raw=JSON.stringify(x),r=before(raw);assert.equal(r.status,'DECLARATIONS_READY');assert.equal(JSON.stringify(x),raw);assert.deepEqual(r.deferredGates,['G05','G06','G09','G10']);safe(r);
});
for(const [name,change] of [
 ['missing race',x=>delete x.raceId],['roster mismatch',x=>x.expectedRunnerCount=3],
 ['unverified identity',x=>x.runners[0].identityVerified=false],['source after cutoff',x=>x.runners[0].capturedAt=x.startAt],
 ['cutoff at start',x=>x.freezeAt=x.startAt],['model missing',x=>delete x.cpsi]
])test(`pre-save holds ${name}`,()=>{const x=declarations();change(x);const r=before(JSON.stringify(x));assert.equal(r.status,'HOLD');safe(r);});
test('exact synthetic bytes match but caller-created anchor never becomes authenticated',()=>{const {raw,anchor}=bundle();const r=after(raw,raw,JSON.stringify(anchor));assert.equal(r.status,'LOCAL_BYTES_MATCH');assert.equal(r.localByteComparisonVerified,true);assert.equal(r.revision,3);safe(r);});
test('equivalent JSON formatting is not exact readback evidence',()=>{const {raw,anchor}=bundle();assert.equal(after(raw,JSON.stringify(JSON.parse(raw),null,2),JSON.stringify(anchor)).status,'HOLD');});
test('different revision readback is rejected',()=>{const {raw,anchor}=bundle(),x=JSON.parse(raw);x.revision++;assert.equal(after(raw,JSON.stringify(x),JSON.stringify(anchor)).status,'HOLD');});
for(const key of ['raceId','snapshotId','revision','freezeId','signalHash','artifactSha256','schemaVersion'])test(`anchor mismatch ${key} holds`,()=>{
 const {raw,anchor}=bundle();anchor[key]=key==='revision'?4:'different';const r=after(raw,raw,JSON.stringify(anchor));assert.equal(r.status,'HOLD');safe(r);
});
for(const [name,change] of [
 ['revision missing',x=>delete x.revision],['revision zero',x=>x.revision=0],['revision fractional',x=>x.revision=1.5],
 ['signal placeholder',x=>x.signalHash='fake'],['wrong artifact schema',x=>x.schemaVersion='other'],
 ['missing receipt',x=>delete x.declarations.early],['evidence not read back',x=>x.declarations.runners[0].evidenceReadback=false],
 ['different race declaration',x=>x.declarations.raceId='different'],['different snapshot declaration',x=>x.declarations.snapshot.id='different'],
 ['different freeze declaration',x=>x.declarations.early.freezeId='different'],['different signal declaration',x=>x.declarations.early.signalHash='c'.repeat(64)]
])test(`self-consistent rehash cannot conceal ${name}`,()=>{const {raw,anchor}=bundle(change);const r=after(raw,raw,JSON.stringify(anchor));assert.equal(r.status,'HOLD');safe(r);});
test('malformed, oversized and non-string inputs hold without invoking callbacks',()=>{
 let calls=0;const object={toString(){calls++;throw Error('PRIVATE');},toJSON(){calls++;throw Error('PRIVATE');}};
 for(const x of [undefined,null,object,[],42,'{','null','[]','x'.repeat(100001)]){safe(before(x));assert.equal(before(x).status,'HOLD');const r=after(x,x,x);assert.equal(r.status,'HOLD');safe(r);}
 assert.equal(calls,0);
});
test('multibyte limit is measured in bytes',()=>{assert.equal(before(JSON.stringify({text:'馬'.repeat(34000)})).status,'HOLD');});
test('invalid evidence does not expose supplied private text',()=>{const r=after('PRIVATE_SECRET','PRIVATE_SECRET','PRIVATE_SECRET');assert.equal(JSON.stringify(r).includes('PRIVATE_SECRET'),false);});
test('no latest fallback and no production flags can bypass missing revision',()=>{const {raw,anchor}=bundle(x=>{delete x.revision;x.latest=true;x.formalKpiEligible=true;x.productionActivationReady=true;});const r=after(raw,raw,JSON.stringify(anchor));assert.equal(r.status,'HOLD');safe(r);});
test('supplementary market and result remain unnecessary',()=>{const {raw,anchor}=bundle();assert.equal(after(raw,raw,JSON.stringify(anchor)).status,'LOCAL_BYTES_MATCH');});
