import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {collectCpsiResearchPacket,verifyCollectorPacket} from '../src/prediction/cpsi-collector-packet-v1.mjs';
import {runCollectorPacketCli,localCollectorPacketStore} from '../scripts/collect-cpsi-research-packet-v1.mjs';
import {TRUST_FORMAT} from '../src/prediction/cpsi-acquisition-attestation-v1.mjs';
import {sourceSha256} from '../src/prediction/cpsi-source-recovery-v1.mjs';
const at=Date.parse('2026-10-21T08:00:00+09:00'),sourceUrl='https://packet-fixture.example/index.json',iso=n=>new Date(n).toISOString();
const image=Uint8Array.from([137,80,78,71,13,10,26,10]);
const sha=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),x=>x.toString(16).padStart(2,'0')).join('');
async function fixture(){
 let now=at,fetches=0,signs=0,loads=0,packet;
 const pair=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']);
 const key={collectorId:'fixture-only',keyId:'fixture-only-key',publicKeySpkiBase64:btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey('spki',pair.publicKey)))),allowedSourceUrls:[sourceUrl],validFrom:iso(at-1000),validUntil:iso(at+86400000),revoked:false};
 const trustPolicy={format:TRUST_FORMAT,collectors:[key]};
 const index={format:'CHASS_CPSI_INDEX_OBSERVATION_V1',race:{organization:'NAR',raceDate:'2026-10-21',track:'浦和',code:'18',raceNo:1,surface:'ダート'},horses:[1,2].map(horseNo=>({horseNo,horseName:'試験'+horseNo,peak:10,baseline5:null,current:null,prev:10,distance:10,course:10}))};
 const raw=JSON.stringify(index);
 const html='<h4>2026年10月21日（水） 浦　和　第1競走 12:20発走</h4>'+[1,2].map(n=>`<tr class="tBorder"><td class="horseNum">${n}</td><td><a class="horseName" href="../DataRoom/HorseMarkInfo?k_lineageLoginCode=3009440491${n}">試験${n}</a></td></tr>`).join('');
 const options={enabled:true,sourceUrl,keyId:key.keyId,clock:()=>now,
  loadTrustPolicy:async()=>{loads++;return structuredClone(trustPolicy);},
  fetchResponse:async(url,opts)=>{fetches++;assert.equal(opts.redirect,'error');assert.equal(opts.credentials,'omit');return {status:200,url,redirected:false,headers:new Headers(),body:new Response(raw).body};},
  acquireCard:async({url})=>{assert.match(url,/^https:\/\/www.keiba.go.jp\//);return html;},
  prepareEvidence:async({sourceBytes,receipt})=>{assert.equal(new TextDecoder().decode(sourceBytes),raw);return {imageBytes:image,transcriptionRaw:JSON.stringify({format:'CHASS_CPSI_RAW_TRANSCRIPTION_V1',ruleVersion:'RAW_SEVEN_STAR_HELD_V1',imageSha256:await sha(image),raceId:receipt.body.artifact.input.raceId,method:'MANUAL_TRANSCRIPTION',rows:receipt.body.artifact.input.horses.map(h=>({horseNo:h.horseNo,horseName:'試験'+h.horseNo,canonicalHorseKey:h.canonicalHorseKey,raw:{highest:'10',average_5:'10*',distance:'10',course:'10',three_runs_ago:'-',two_runs_ago:'未',previous_run:'10'}}))})};},
  sign:async message=>{signs++;return new Uint8Array(await crypto.subtle.sign('Ed25519',pair.privateKey,message));},
  store:{async insertIfAbsent(id,value){if(packet)return false;packet=structuredClone(value);return true;},async get(){return structuredClone(packet);}}
 };
 return {options,trustPolicy,raw,get packet(){return packet;},get now(){return now;},set now(v){now=v;},get fetches(){return fetches;},get signs(){return signs;},get loads(){return loads;}};
}
test('OFF touches no adapters, policy, files or network',async()=>{
 const r=await collectCpsiResearchPacket({get store(){assert.fail();},get fetchResponse(){assert.fail();}});assert.equal(r.status,'DISABLED');
 const cli=await runCollectorPacketCli([],{loadAdapter:()=>assert.fail()});assert.equal(cli.status,'DISABLED');
});
test('full synthetic acquisition, Producer, signature, archive and packet readback bind exact bytes without formal promotion',async()=>{
 const f=await fixture(),before=JSON.stringify(f.trustPolicy),r=await collectCpsiResearchPacket(f.options);
 assert.equal(r.status,'COLLECTOR_PACKET_READBACK_VERIFIED_RESEARCH_ONLY');assert.equal(r.readbackVerified,true);assert.equal(r.storageState,'READBACK_VERIFIED');assert.equal(f.fetches,1);assert.equal(f.signs,1);assert.equal(f.loads,3);
 assert.equal(r.observationBytesMatchResponse,true);assert.equal(r.liveAdmissionChecked,false);
 for(const k of ['sourceOriginAuthenticated','formalKpiEligible','importable','originalEarlyMutation','productionWritePerformed'])assert.equal(r[k],false);
 assert.equal(JSON.stringify(f.trustPolicy),before);assert.equal((await verifyCollectorPacket(f.packet,{trustPolicy:f.trustPolicy,now:f.now})).contentHash,r.contentHash);
});
for(const kind of ['missing-adapter','unknown-key','revoked','capture-failure','html-response','wrong-card','bad-transcription','bad-image','wrong-signature','late-preparation','revoked-before-store'])test('pipeline holds '+kind+' without a final store write',async()=>{
 const f=await fixture(),o=f.options;
 if(kind==='missing-adapter')delete o.sign;if(kind==='unknown-key')o.keyId='unknown';if(kind==='revoked')f.trustPolicy.collectors[0].revoked=true;
 if(kind==='capture-failure')o.fetchResponse=async()=>{throw Error('network');};
 if(kind==='html-response')o.fetchResponse=async url=>({status:200,url,headers:new Headers(),body:new Response('<html>not index observation</html>').body});
 if(kind==='wrong-card')o.acquireCard=async()=>'<html>wrong race</html>';
 if(['bad-transcription','bad-image','late-preparation'].includes(kind)){const original=o.prepareEvidence;o.prepareEvidence=async x=>{const e=await original(x);if(kind==='bad-transcription'){const t=JSON.parse(e.transcriptionRaw);t.rows[0].raw.highest='999';e.transcriptionRaw=JSON.stringify(t);}if(kind==='bad-image')e.imageBytes=new Uint8Array(8);if(kind==='late-preparation')f.now=at+60001;return e;};}
 if(kind==='wrong-signature')o.sign=async()=>new Uint8Array(64);
 if(kind==='revoked-before-store'){let n=0;o.loadTrustPolicy=async()=>{const p=structuredClone(f.trustPolicy);if(++n>1)p.collectors[0].revoked=true;return p;};}
 const r=await collectCpsiResearchPacket(o);assert.equal(r.status,'HOLD');assert.equal(r.readbackVerified,false);assert.equal(r.storageState,'NOT_ATTEMPTED');assert.equal(f.packet,undefined);assert.equal(r.sourceOriginAuthenticated,false);
 if(['bad-transcription','bad-image'].includes(kind))assert.equal(f.signs,0);
});
for(const kind of ['collision','write-error','read-error','tampered-readback','revoked-on-readback','post-during-readback','stale-during-readback'])test('store failure '+kind+' cannot return verified readiness',async()=>{
 const f=await fixture(),o=f.options;
 if(kind==='collision')o.store.insertIfAbsent=async()=>false;if(kind==='write-error')o.store.insertIfAbsent=async()=>{throw Error('disk');};
 if(kind==='read-error')o.store.get=async()=>{throw Error('disk');};
 if(['tampered-readback','post-during-readback','stale-during-readback'].includes(kind)){const get=o.store.get;o.store.get=async id=>{const p=await get(id);if(kind==='tampered-readback')p.body.responseBase64='AAAA';if(kind==='post-during-readback')f.now=Date.parse('2026-10-21T12:20:00+09:00');if(kind==='stale-during-readback')f.now=at+60001;return p;};}
 if(kind==='revoked-on-readback'){let n=0;o.loadTrustPolicy=async()=>{const p=structuredClone(f.trustPolicy);if(++n>2)p.collectors[0].revoked=true;return p;};}
 const r=await collectCpsiResearchPacket(o);assert.equal(r.status,'HOLD');assert.equal(r.readbackVerified,false);assert.equal(r.importable,false);assert.equal(r.storageState,kind==='collision'||kind==='write-error'?'INSERT_ATTEMPTED':'INSERTED_UNVERIFIED');
});
test('changing returned response bytes and recomputing unsigned outer hash cannot bypass signature or exact observation binding',async()=>{
 const f=await fixture();await collectCpsiResearchPacket(f.options);const p=structuredClone(f.packet);p.body.responseBase64=btoa('different bytes');p.contentHash=await sourceSha256(p.body);
 await assert.rejects(()=>verifyCollectorPacket(p,{trustPolicy:f.trustPolicy,now:f.now}),/PACKET_OBSERVATION_BYTES_MISMATCH/);
});
test('unknown packet fields, embedded policy, promoted flags and absent independent policy are refused',async()=>{
 const f=await fixture();await collectCpsiResearchPacket(f.options);
 for(const change of [p=>p.body.trustPolicy=f.trustPolicy,p=>p.body.formalKpiEligible=true,p=>p.format='other']){const p=structuredClone(f.packet);change(p);await assert.rejects(()=>verifyCollectorPacket(p,{trustPolicy:f.trustPolicy,now:f.now}));}
 await assert.rejects(()=>verifyCollectorPacket(f.packet,{now:f.now}),/APPROVED_COLLECTOR_TRUST_MISSING/);
});
test('CLI uses actual exclusive local files and independent readback; repeat Run cannot overwrite',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'chass-packet-'));
 try{const f=await fixture(),adapter={...f.options};delete adapter.store;
  const r=await runCollectorPacketCli(['--enabled','--adapter-file','explicit-operator-adapter.mjs','--output-dir',dir],{loadAdapter:async()=>adapter,clock:()=>f.now});
  assert.equal(r.status,'COLLECTOR_PACKET_READBACK_VERIFIED_RESEARCH_ONLY');assert.equal(r.readbackScope,'LOCAL_FILESYSTEM');
  const saved=JSON.parse(await readFile(r.outputFile,'utf8'));assert.equal(saved.contentHash,r.contentHash);await verifyCollectorPacket(saved,{trustPolicy:f.trustPolicy,now:f.now});
  assert.equal(await localCollectorPacketStore(dir).insertIfAbsent(r.runId,saved),false);
  await assert.rejects(()=>localCollectorPacketStore(dir).get('../escape'));
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('CLI rejects missing/duplicate/unknown arguments before loading executable adapters',async()=>{
 for(const argv of [['--enabled'],['--enabled','--adapter-file','x','--adapter-file','y'],['--enabled','--unknown','x'],['--enabled','--adapter-file','--output-dir','x']])await assert.rejects(()=>runCollectorPacketCli(argv,{loadAdapter:()=>assert.fail()}));
});
