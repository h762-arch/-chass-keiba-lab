import test from 'node:test';import assert from 'node:assert/strict';
import {captureCollectorResponse,signCollectorAcquisition} from '../src/prediction/cpsi-live-collector-v1.mjs';
import {captureCpsiPreRun} from '../src/prediction/cpsi-pre-producer-v1.mjs';
import {createIndexEvidence} from '../src/prediction/cpsi-index-evidence-v1.mjs';
import {verifyAcquisitionAttestation,TRUST_FORMAT} from '../src/prediction/cpsi-acquisition-attestation-v1.mjs';
const at=Date.parse('2026-10-21T08:00:00+09:00'),sourceUrl='https://collector-fixture.example/data',iso=n=>new Date(n).toISOString();
const image=Uint8Array.from([137,80,78,71,13,10,26,10]);
const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
const fixtureIndex={format:'CHASS_CPSI_INDEX_OBSERVATION_V1',race:{organization:'NAR',raceDate:'2026-10-21',track:'浦和',code:'18',raceNo:1,surface:'ダート'},horses:[1,2].map(horseNo=>({horseNo,horseName:'試験'+horseNo,peak:10,baseline5:null,current:null,prev:10,distance:10,course:10}))};
async function fixture(){
 let now=at,calls=0,receipt;
 const pair=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']);
 const key={collectorId:'test-only',keyId:'test-only-key',publicKeySpkiBase64:btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey('spki',pair.publicKey)))),allowedSourceUrls:[sourceUrl],validFrom:iso(at-1000),validUntil:iso(at+86400000),revoked:false};
 const bytes=new TextEncoder().encode(JSON.stringify(fixtureIndex));
 const response=()=>({status:200,url:sourceUrl,redirected:false,headers:new Headers(),body:new Response(bytes.slice()).body});
 const captureArgs={enabled:true,sourceUrl,key,clock:()=>now,fetchResponse:async(url,opts)=>{calls++;assert.equal(url,sourceUrl);assert.equal(opts.redirect,'error');assert.equal(opts.credentials,'omit');assert.equal(opts.method,'GET');return response();}};
 const html='<h4>2026年10月21日（水） 浦　和　第1競走 12:20発走</h4>'+[1,2].map(n=>`<tr class="tBorder"><td class="horseNum">${n}</td><td><a class="horseName" href="../DataRoom/HorseMarkInfo?k_lineageLoginCode=3009440491${n}">試験${n}</a></td></tr>`).join('');
 async function produce(raw){const r=await captureCpsiPreRun({enabled:true,clock:()=>now,acquireIndex:async()=>raw,acquireCard:async()=>html,store:{insertIfAbsent:async(id,v)=>{receipt=structuredClone(v);return true;},get:async()=>structuredClone(receipt)}});assert.equal(r.status,'LOCAL_PRE_SOURCE_READY');return receipt;}
 const sign=async data=>new Uint8Array(await crypto.subtle.sign('Ed25519',pair.privateKey,data));
 return {key,bytes,response,captureArgs,produce,sign,get now(){return now;},set now(v){now=v;},get calls(){return calls;}};
}
async function ready(){const f=await fixture(),captured=await captureCollectorResponse(f.captureArgs);assert.equal(captured.status,'CAPTURED_RESEARCH_ONLY');const receipt=await f.produce(new TextDecoder().decode(captured.sourceBytes));return {f,captured,receipt,args:{enabled:true,handle:captured.handle,receiptRaw:JSON.stringify(receipt),imageBytes:image,sign:f.sign,clock:()=>f.now}};}
test('disabled collector and signer inspect nothing and perform no network or signing',async()=>{
 const input={get key(){assert.fail();},get fetchResponse(){return async()=>assert.fail();}};
 assert.equal((await captureCollectorResponse(input)).status,'DISABLED');assert.equal((await signCollectorAcquisition({handle:{},sign:()=>assert.fail()})).status,'DISABLED');
});
test('actual byte stream -> Producer receipt -> signing -> immutable archive -> pinned verification remains research only',async()=>{
 const {f,captured,receipt,args}=await ready();const signed=await signCollectorAcquisition(args);assert.equal(signed.status,'SIGNED_RESEARCH_ONLY');assert.deepEqual(signed.sourceBytes,f.bytes);assert.equal(f.calls,1);
 const t={format:'CHASS_CPSI_RAW_TRANSCRIPTION_V1',ruleVersion:'RAW_SEVEN_STAR_HELD_V1',imageSha256:await sha(image),raceId:receipt.body.artifact.input.raceId,method:'MANUAL_TRANSCRIPTION',rows:receipt.body.artifact.input.horses.map(h=>({horseNo:h.horseNo,horseName:'試験'+h.horseNo,canonicalHorseKey:h.canonicalHorseKey,raw:{highest:'10',average_5:'10*',distance:'10',course:'10',three_runs_ago:'-',two_runs_ago:'未',previous_run:'10'}}))};
 const archive=await createIndexEvidence({receiptRaw:args.receiptRaw,transcriptionRaw:JSON.stringify(t),imageBytes:image,recordedAt:f.now});
 const result=await verifyAcquisitionAttestation({enabled:true,archive,attestation:signed.attestation,trustPolicy:{format:TRUST_FORMAT,collectors:[f.key]},sourceBytes:signed.sourceBytes,now:f.now});assert.equal(result.collectorSignatureVerified,true);
 for(const r of [captured,signed,result])for(const k of ['sourceOriginAuthenticated','formalKpiEligible','importable','originalEarlyMutation'])assert.equal(r[k],false);
 assert.equal((await signCollectorAcquisition(args)).reason,'COLLECTOR_CAPTURE_HANDLE_REQUIRED');
});
for(const kind of ['revoked','expired','unlisted','http','credentials','fragment','invalid-date','missing-fetch'])test('collector blocks '+kind+' before network',async()=>{
 const f=await fixture(),a=f.captureArgs;
 if(kind==='revoked')a.key.revoked=true;if(kind==='expired')a.key.validUntil=iso(at);if(kind==='unlisted')a.sourceUrl='https://other.example/';
 if(kind==='http')a.sourceUrl='http://collector-fixture.example/data';if(kind==='credentials')a.sourceUrl='https://secret:secret@collector-fixture.example/data';if(kind==='fragment')a.sourceUrl=sourceUrl+'#x';
 if(kind==='invalid-date')a.key.validFrom='2026-02-30T00:00:00Z';if(kind==='missing-fetch')delete a.fetchResponse;
 assert.equal((await captureCollectorResponse(a)).status,'HOLD');assert.equal(f.calls,0);
});
for(const kind of ['redirect','different-url','status','length','oversized','empty','broken-stream','clock-rollback'])test('capture refuses '+kind,async()=>{
 const f=await fixture(),r=f.response();
 if(kind==='redirect')r.redirected=true;if(kind==='different-url')r.url='https://other.example/';if(kind==='status')r.status=302;if(kind==='length')r.headers.set('content-length','1048577');
 if(kind==='oversized')r.body=new Response(new Uint8Array(1048577)).body;if(kind==='empty')r.body=new Response(new Uint8Array()).body;
 if(kind==='broken-stream')r.body=new ReadableStream({start(c){c.error(Error('network'));}});
 f.captureArgs.fetchResponse=async()=>{if(kind==='clock-rollback')f.now=at-1;return r;};assert.equal((await captureCollectorResponse(f.captureArgs)).status,'HOLD');
});
test('fetch and body timeouts are bounded and abort the adapter / cancel the reader',async()=>{
 for(const mode of ['fetch','body']){const f=await fixture();let signal,cancelled=false;f.captureArgs.timeoutMs=100;
 f.captureArgs.fetchResponse=async(url,opts)=>{signal=opts.signal;if(mode==='fetch')return new Promise(()=>{});return {...f.response(),body:new ReadableStream({pull(){return new Promise(()=>{});},cancel(){cancelled=true;}})};};
 assert.equal((await captureCollectorResponse(f.captureArgs)).reason,'COLLECTOR_TIMEOUT');assert.equal(signal.aborted,true);if(mode==='body')assert.equal(cancelled,true);
 }
});
for(const kind of ['fabricated-handle','wrong-signer','mutated-receipt','bad-image','stale','after-post','sign-completes-late','key-expires-during-sign','signer-throws'])test('signer refuses '+kind,async()=>{
 const {f,args}=await ready();
 if(kind==='fabricated-handle')args.handle={};if(kind==='wrong-signer')args.sign=async()=>new Uint8Array(64);if(kind==='mutated-receipt'){const r=JSON.parse(args.receiptRaw);r.body.artifact.input.runId='changed';args.receiptRaw=JSON.stringify(r);}
 if(kind==='bad-image')args.imageBytes=new Uint8Array(8);if(kind==='stale')f.now=at+60001;if(kind==='after-post')f.now=Date.parse('2026-10-21T12:20:00+09:00');
 if(kind==='sign-completes-late')args.sign=async data=>{const s=await f.sign(data);f.now=at+60001;return s;};
 if(kind==='key-expires-during-sign'){const base=f.now;args.clock=()=>f.now;f.key.validUntil=iso(base+1);/* handle pins acquisition policy; use a separate short-lived capture */const g=await fixture();g.key.validUntil=iso(at+1);const c=await captureCollectorResponse(g.captureArgs);const r=await g.produce(new TextDecoder().decode(c.sourceBytes));Object.assign(args,{handle:c.handle,receiptRaw:JSON.stringify(r),clock:()=>g.now,sign:async data=>{const s=await g.sign(data);g.now=at+1;return s;}});}
 if(kind==='signer-throws')args.sign=async()=>{throw Error('private key service unavailable');};
 const r=await signCollectorAcquisition(args);assert.equal(r.status,'HOLD');assert.equal(r.sourceOriginAuthenticated,false);
});
test('public response copies and policy mutations do not substitute captured bytes or pinned identity',async()=>{
 const {f,captured,args}=await ready();captured.sourceBytes.fill(0);f.key.collectorId='attacker';
 const s=await signCollectorAcquisition(args);assert.equal(s.status,'SIGNED_RESEARCH_ONLY');assert.deepEqual(s.sourceBytes,f.bytes);assert.equal(s.attestation.payload.collectorId,'test-only');
});
test('signer timeout quarantines the one-use capture without a partial attestation',async()=>{
 const {args}=await ready();args.sign=()=>new Promise(()=>{});args.timeoutMs=100;
 assert.equal((await signCollectorAcquisition(args)).reason,'COLLECTOR_TIMEOUT');assert.equal((await signCollectorAcquisition(args)).reason,'COLLECTOR_CAPTURE_HANDLE_REQUIRED');
});
