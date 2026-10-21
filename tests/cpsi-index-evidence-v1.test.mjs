import test from'node:test';import assert from'node:assert/strict';
import{mkdtemp,readFile,writeFile,readdir}from'node:fs/promises';import path from'node:path';import os from'node:os';
import{captureCpsiPreRun}from'../src/prediction/cpsi-pre-producer-v1.mjs';
import{sourceSha256,stableSourceJson}from'../src/prediction/cpsi-source-recovery-v1.mjs';
import{createIndexEvidence,verifyIndexEvidence,saveIndexEvidenceAndReadback,parseRawIndexCell,TRANSCRIPTION_FORMAT,RULE_VERSION}from'../src/prediction/cpsi-index-evidence-v1.mjs';
import{runIndexEvidenceCli}from'../scripts/archive-cpsi-index-evidence-v1.mjs';
const now=Date.parse('2026-10-21T08:00:00+09:00'),copy=x=>JSON.parse(JSON.stringify(x));
async function fixture(){
 const index={format:'CHASS_CPSI_INDEX_OBSERVATION_V1',race:{organization:'NAR',raceDate:'2026-10-21',track:'浦和',code:'18',raceNo:1,surface:'ダート'},horses:[1,2].map(horseNo=>({horseNo,horseName:'試験'+horseNo,peak:0,baseline5:null,current:null,prev:-2,distance:0,course:-1}))};
 const html='<h4>2026年10月21日（水） 浦　和　第1競走 12:20発走</h4>'+[1,2].map(n=>`<tr class="tBorder"><td class="horseNum">${n}</td><td><a class="horseName" href="../DataRoom/HorseMarkInfo?k_lineageLoginCode=3009440491${n}">試験${n}</a></td></tr>`).join('');
 let saved;const r=await captureCpsiPreRun({enabled:true,clock:()=>now,acquireIndex:async()=>JSON.stringify(index),acquireCard:async()=>html,store:{insertIfAbsent:async(id,v)=>{saved=copy(v);return true;},get:async()=>saved}});assert.equal(r.status,'LOCAL_PRE_SOURCE_READY');
 const imageBytes=Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0]);const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',imageBytes)),x=>x.toString(16).padStart(2,'0')).join('');
 const transcription={format:TRANSCRIPTION_FORMAT,ruleVersion:RULE_VERSION,imageSha256:hash,raceId:r.receipt.body.artifact.input.raceId,method:'MANUAL_TRANSCRIPTION',rows:r.receipt.body.artifact.input.horses.map((h,i)=>({horseNo:h.horseNo,horseName:'試験'+(i+1),canonicalHorseKey:h.canonicalHorseKey,raw:{highest:'0',average_5:'4*',distance:'0',course:'-1',three_runs_ago:'-',two_runs_ago:'未',previous_run:'-2'}}))};
 return {receiptRaw:JSON.stringify(r.receipt,null,2)+'\n',transcriptionRaw:JSON.stringify(transcription,null,2)+'\n',imageBytes,recordedAt:now+86400000,transcription};
}
const args=f=>({receiptRaw:f.receiptRaw,transcriptionRaw:f.transcriptionRaw,imageBytes:f.imageBytes,recordedAt:f.recordedAt});
test('historical archive preserves exact text/PNG bytes, null/star decisions and unchanged existing Run',async()=>{
 const f=await fixture(),before=f.receiptRaw,a=await createIndexEvidence(args(f));await verifyIndexEvidence(a);
 assert.equal(a.body.receiptRaw,before);assert.equal(a.body.transcriptionRaw,f.transcriptionRaw);assert.deepEqual(Uint8Array.from(atob(a.body.image.base64),c=>c.charCodeAt(0)),f.imageBytes);
 assert.equal(a.body.sourceOriginAuthenticated,false);assert.equal(a.body.importable,false);assert.equal(a.body.formalKpiEligible,false);assert.equal(a.body.timeMeaning,'LOCAL_ARCHIVE_CREATION_NOT_SOURCE_CAPTURE');
 assert.deepEqual(a.body.decisions[0].cells.average_5,{raw:'4*',numericCandidate:4,adoptedValue:null,reason:'STAR_UNRESOLVED_HELD'});assert.equal(a.body.decisions[0].cells.highest.adoptedValue,0);assert.equal(a.body.decisions[0].cells.previous_run.adoptedValue,-2);assert.equal(f.receiptRaw,before);
});
test('raw parser separates zero/negative/missing/unresolved and rejects unsupported symbols',()=>{
 for(const v of ['-','未'])assert.equal(parseRawIndexCell(v,'distance').adoptedValue,null);
 assert.equal(parseRawIndexCell('-2','previous_run').adoptedValue,-2);assert.equal(parseRawIndexCell('0','highest').adoptedValue,0);
 for(const [v,c]of [['1.5','highest'],['3*','highest'],['4※','average_5'],['1e3','highest'],['9007199254740992','highest'],[' 3','highest'],[3,'highest']])assert.throws(()=>parseRawIndexCell(v,c));
});
for(const kind of ['wrong image','wrong race','duplicate horse','wrong key','wrong name','wrong primitive','extra field','unsupported rule','current value','star adoption'])test(`archive refuses ${kind}`,async()=>{
 const f=await fixture(),t=f.transcription;
 if(kind==='wrong image')f.imageBytes[10]^=1;
 if(kind==='wrong race')t.raceId='OTHER';
 if(kind==='duplicate horse')t.rows[1]=copy(t.rows[0]);
 if(kind==='wrong key')t.rows[0].canonicalHorseKey=t.rows[1].canonicalHorseKey;
 if(kind==='wrong name')t.rows[0].horseName='別馬';
 if(kind==='wrong primitive')t.rows[0].raw.highest='99';
 if(kind==='extra field')t.sourceOriginAuthenticated=true;
 if(kind==='unsupported rule')t.ruleVersion='STRIP_STARS';
 if(kind==='current value'){const r=JSON.parse(f.receiptRaw);r.body.artifact.input.horses[0].canonicalIndex.current=3;f.receiptRaw=JSON.stringify(r);}
 if(kind==='star adoption')t.rows[0].raw.average_5='4';
 f.transcriptionRaw=JSON.stringify(t);await assert.rejects(createIndexEvidence(args(f)));
});
test('archive rejects malformed/oversized image, input text and creation before Freeze',async()=>{
 const f=await fixture();for(const imageBytes of [new Uint8Array(0),new Uint8Array(786433),new Uint8Array(12)])await assert.rejects(createIndexEvidence({...args(f),imageBytes}));
 await assert.rejects(createIndexEvidence({...args(f),receiptRaw:' '.repeat(1500001)}));await assert.rejects(createIndexEvidence({...args(f),transcriptionRaw:'{'}));await assert.rejects(createIndexEvidence({...args(f),recordedAt:now-1}));
});
test('rehashed envelope cannot bypass raw bindings or governance; exact archive shape required',async()=>{
 const a=await createIndexEvidence(args(await fixture()));
 for(const change of [x=>x.body.sourceOriginAuthenticated=true,x=>x.body.decisions[0].cells.average_5.adoptedValue=4,x=>x.body.runId='OTHER',x=>x.body.extra=true]){
  const b=copy(a);change(b);b.contentHash=await sourceSha256(b.body);await assert.rejects(verifyIndexEvidence(b));
 }
 await assert.rejects(verifyIndexEvidence({...a,extra:true}));const bad=copy(a);bad.body.image.base64+='=';bad.contentHash=await sourceSha256(bad.body);await assert.rejects(verifyIndexEvidence(bad));
});
test('independent commit/read verifies exact archive; duplicates and failed/corrupt reads refuse success',async()=>{
 const a=await createIndexEvidence(args(await fixture())),original=stableSourceJson(a);let stored;const events=[];
 const store={insertIfAbsent:async(id,v)=>{events.push('commit');stored=copy(v);return true;},get:async()=>{events.push('read');return stored;}};
 const r=await saveIndexEvidenceAndReadback(store,a);assert.equal(r.status,'LOCAL_INDEX_EVIDENCE_READBACK_VERIFIED');assert.deepEqual(events,['commit','read']);assert.equal(stableSourceJson(a),original);
 await assert.rejects(saveIndexEvidenceAndReadback({insertIfAbsent:async()=>false,get:async()=>assert.fail('read forbidden')},a),/EVIDENCE_ALREADY_EXISTS/);
 for(const get of [async()=>{throw Error('READ_FAILED');},async()=>{const b=copy(a);b.body.image.base64='AAAA';return b;}])await assert.rejects(saveIndexEvidenceAndReadback({insertIfAbsent:async()=>true,get},a));
 await assert.rejects(saveIndexEvidenceAndReadback({insertIfAbsent:async()=>{throw Error('DISK_FULL');},get:async()=>a},a));
});
test('CLI OFF never reads paths; enabled CLI creates a separate immutable archive and independently reads it',async()=>{
 assert.equal((await runIndexEvidenceCli(['--receipt-file','/absent'])).status,'DISABLED');
 const f=await fixture(),dir=await mkdtemp(path.join(os.tmpdir(),'chass-index-evidence-'));const file=n=>path.join(dir,n);
 await writeFile(file('receipt.json'),f.receiptRaw);await writeFile(file('raw.json'),f.transcriptionRaw);await writeFile(file('image.png'),f.imageBytes);
 const argv=['--enabled','--receipt-file',file('receipt.json'),'--transcription-file',file('raw.json'),'--image-file',file('image.png'),'--output-dir',file('archives')];
 const r=await runIndexEvidenceCli(argv,{clock:()=>f.recordedAt});assert.equal(r.status,'LOCAL_INDEX_EVIDENCE_READBACK_VERIFIED');assert.equal(r.readbackScope,'LOCAL_FILESYSTEM');assert.equal(r.productionWritePerformed,false);
 await verifyIndexEvidence(JSON.parse(await readFile(path.join(r.outputDirectory,'evidence.json'),'utf8')));assert.equal(await readFile(file('receipt.json'),'utf8'),f.receiptRaw);
 const again=await runIndexEvidenceCli(argv,{clock:()=>f.recordedAt});assert.notEqual(again.outputDirectory,r.outputDirectory);assert.equal((await readdir(file('archives'))).length,2);
 await assert.rejects(runIndexEvidenceCli([...argv,'--unknown']));await assert.rejects(runIndexEvidenceCli(['--enabled']));
});
