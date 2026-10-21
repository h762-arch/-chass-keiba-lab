import test from'node:test';import assert from'node:assert/strict';
import{captureCpsiPreRun}from'../src/prediction/cpsi-pre-producer-v1.mjs';
import{createIndexEvidence}from'../src/prediction/cpsi-index-evidence-v1.mjs';
import{verifyAcquisitionAttestation,acquisitionSigningBytes,ATTESTATION_FORMAT,TRUST_FORMAT}from'../src/prediction/cpsi-acquisition-attestation-v1.mjs';
const at=Date.parse('2026-10-21T08:00:00+09:00'),iso=n=>new Date(n).toISOString(),copy=x=>JSON.parse(JSON.stringify(x));
const b64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes)));
async function sha(bytes){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');}
async function fixture(){
 const ix={format:'CHASS_CPSI_INDEX_OBSERVATION_V1',race:{organization:'NAR',raceDate:'2026-10-21',track:'浦和',code:'18',raceNo:1,surface:'ダート'},horses:[1,2].map(horseNo=>({horseNo,horseName:'試験'+horseNo,peak:10,baseline5:null,current:null,prev:10,distance:10,course:10}))};
 const html='<h4>2026年10月21日（水） 浦　和　第1競走 12:20発走</h4>'+[1,2].map(n=>`<tr class="tBorder"><td class="horseNum">${n}</td><td><a class="horseName" href="../DataRoom/HorseMarkInfo?k_lineageLoginCode=3009440491${n}">試験${n}</a></td></tr>`).join('');
 let receipt;const pre=await captureCpsiPreRun({enabled:true,clock:()=>at,acquireIndex:async()=>JSON.stringify(ix),acquireCard:async()=>html,store:{insertIfAbsent:async(id,v)=>{receipt=copy(v);return true;},get:async()=>receipt}});assert.equal(pre.status,'LOCAL_PRE_SOURCE_READY');
 const image=Uint8Array.from([137,80,78,71,13,10,26,10]);
 const t={format:'CHASS_CPSI_RAW_TRANSCRIPTION_V1',ruleVersion:'RAW_SEVEN_STAR_HELD_V1',imageSha256:await sha(image),raceId:receipt.body.artifact.input.raceId,method:'MANUAL_TRANSCRIPTION',rows:receipt.body.artifact.input.horses.map(h=>({horseNo:h.horseNo,horseName:'試験'+h.horseNo,canonicalHorseKey:h.canonicalHorseKey,raw:{highest:'10',average_5:'10*',distance:'10',course:'10',three_runs_ago:'-',two_runs_ago:'未',previous_run:'10'}}))};
 const archive=await createIndexEvidence({receiptRaw:JSON.stringify(receipt),transcriptionRaw:JSON.stringify(t),imageBytes:image,recordedAt:at+86400000});
 const sourceBytes=new TextEncoder().encode('<html>synthetic provider response, NOT a real capture</html>'),keys=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']);
 const sourceUrl='https://nar.sp.netkeiba.com/race/speed.html?race_id=202642102101';
 const trustPolicy={format:TRUST_FORMAT,collectors:[{collectorId:'fixture-collector',keyId:'fixture-key',publicKeySpkiBase64:b64(await crypto.subtle.exportKey('spki',keys.publicKey)),allowedSourceUrls:[sourceUrl],validFrom:iso(at-86400000),validUntil:iso(at+86400000),revoked:false}]};
 const attestation={format:ATTESTATION_FORMAT,algorithm:'Ed25519',keyId:'fixture-key',payload:{collectorId:'fixture-collector',sourceUrl,requestMethod:'GET',httpStatus:200,acquiredAt:iso(at),signedAt:iso(at+1),receiptContentHash:archive.body.receiptContentHash,sourceHash:archive.body.sourceHash,imageSha256:archive.body.image.sha256,providerBytesSha256:await sha(sourceBytes),raceId:archive.body.raceId,runId:archive.body.runId},signatureBase64:''};
 const sign=async()=>{attestation.signatureBase64=b64(await crypto.subtle.sign('Ed25519',keys.privateKey,acquisitionSigningBytes(attestation)));};await sign();
 return{args:{enabled:true,archive,attestation,trustPolicy,sourceBytes,now:at+86400001},sign};
}
test('default OFF does not inspect inputs; missing signature/policy hold without claiming authentication',async()=>{
 const r=await verifyAcquisitionAttestation({archive:{get body(){assert.fail('must not inspect');}}});assert.equal(r.status,'DISABLED');
 assert.equal((await verifyAcquisitionAttestation({enabled:true})).reason,'SIGNED_ACQUISITION_RECEIPT_MISSING');
 assert.equal((await verifyAcquisitionAttestation({enabled:true,attestation:{}})).reason,'APPROVED_COLLECTOR_TRUST_MISSING');
});
test('real Ed25519 verification binds pinned collector claims and bytes, but never promotes provider or formal admission',async()=>{
 const f=await fixture(),before=JSON.stringify(f.args),r=await verifyAcquisitionAttestation(f.args);
 assert.equal(r.status,'COLLECTOR_SIGNATURE_VERIFIED_RESEARCH_ONLY');assert.equal(r.collectorSignatureVerified,true);
 for(const k of ['sourceOriginAuthenticated','formalKpiEligible','importable','providerIdentityIndependentlyVerified','providerContentParsed','independentCaptureTimeVerified','livePreAdmissionChecked'])assert.equal(r[k],false);
 assert.equal(r.productionActivationDecision,'NO-GO');assert.equal(JSON.stringify(f.args),before);
});
for(const kind of ['unknown key','revoked key','wrong issuer','expired key','duplicate key','embedded key','wrong algorithm','wrong bytes','tampered signature','other public key','unlisted URL','insecure URL','future signature','late acquisition','after post','reversed time','other Run','other receipt','other image','extra payload'])test(`attestation refuses ${kind}`,async()=>{
 const f=await fixture(),a=f.args,t=a.attestation,p=t.payload,k=a.trustPolicy.collectors[0];let resign=false;
 if(kind==='unknown key')t.keyId='unknown';
 if(kind==='revoked key')k.revoked=true;
 if(kind==='wrong issuer'){p.collectorId='unknown';resign=true;}
 if(kind==='expired key')k.validUntil=iso(at);
 if(kind==='duplicate key')a.trustPolicy.collectors.push(copy(k));
 if(kind==='embedded key')t.publicKeySpkiBase64=k.publicKeySpkiBase64;
 if(kind==='wrong algorithm')t.algorithm='none';
 if(kind==='wrong bytes')a.sourceBytes[0]^=1;
 if(kind==='tampered signature')t.signatureBase64=b64(new Uint8Array(64));
 if(kind==='other public key'){const keys=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']);k.publicKeySpkiBase64=b64(await crypto.subtle.exportKey('spki',keys.publicKey));}
 if(kind==='unlisted URL'){p.sourceUrl='https://example.org/';resign=true;}
 if(kind==='insecure URL'){p.sourceUrl='http://example.org/';k.allowedSourceUrls=[p.sourceUrl];resign=true;}
 if(kind==='future signature'){p.signedAt=iso(a.now+1);resign=true;}
 if(kind==='late acquisition'){p.acquiredAt=iso(at-60001);p.signedAt=iso(at-1);resign=true;}
 if(kind==='after post'){p.acquiredAt='2026-10-21T12:20:00+09:00';p.signedAt=p.acquiredAt;resign=true;}
 if(kind==='reversed time'){p.signedAt=iso(at-1);resign=true;}
 if(kind==='other Run'){p.runId='OTHER';resign=true;}
 if(kind==='other receipt'){p.receiptContentHash='sha256:'+'0'.repeat(64);resign=true;}
 if(kind==='other image'){p.imageSha256='0'.repeat(64);resign=true;}
 if(kind==='extra payload'){p.formalKpiEligible=true;resign=true;}
 if(resign)await f.sign();const r=await verifyAcquisitionAttestation(a);assert.equal(r.status,'HOLD',kind);assert.equal(r.collectorSignatureVerified,false);assert.equal(r.sourceOriginAuthenticated,false);
});
test('malformed/timezone-less time, invalid encoding, invalid archive and oversized bytes stay HOLD',async()=>{
 for(const mutate of [a=>a.attestation.payload.acquiredAt='2026-10-21T08:00:00',a=>a.attestation.signatureBase64='bad',a=>a.archive.body.receiptRaw='{}',a=>a.sourceBytes=new Uint8Array(1048577),a=>a.sourceBytes=new Uint8Array(),a=>a.now=NaN]){const f=await fixture();mutate(f.args);const r=await verifyAcquisitionAttestation(f.args);assert.equal(r.status,'HOLD');assert.equal(r.sourceOriginAuthenticated,false);}
});
test('impossible calendar dates in separately provisioned key policy cannot normalize into accepted dates',async()=>{
 const f=await fixture();f.args.trustPolicy.collectors[0].validFrom='2026-02-30T00:00:00Z';
 const r=await verifyAcquisitionAttestation(f.args);assert.equal(r.status,'HOLD');assert.equal(r.reason,'ATTESTATION_TIME_INVALID');
});
