import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile,readdir,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {publishNarStatusSnapshot,validateNarStatusPayload,runNarStatusPublisherCli,STATUS_BODY_LIMIT} from '../scripts/publish-nar-status-snapshot.mjs';
const date='2026-10-15',now=()=>new Date('2026-10-15T08:00:00Z');
const sample=()=>({ok:true,date,schemaReady:true,historyStoreSchemaReady:true,savedRaceCount:0,rejectedRowCount:0,races:[],trackCodes:['21'],effectiveMaxJobs:3,datedTrial:{date:'2026-10-18',code:'22',status:'SCHEDULED'},researchOnly:true,formalKpiEligible:false,productionActivationReady:false});
async function fixture(t){const outputRoot=await mkdtemp(path.join(tmpdir(),'chass-status-'));t.after(()=>rm(outputRoot,{recursive:true,force:true}));return {outputRoot,date,now,fetchImpl:async()=>Response.json(sample())};}
const load=(root,p)=>readFile(path.join(root,p),'utf8').then(JSON.parse);
test('capture preserves zero-race status, dated trial, flags and a reproducible payload hash',async t=>{
 const f=await fixture(t),p=sample(),r=await publishNarStatusSnapshot({...f,fetchImpl:async()=>Response.json(p)});assert.equal(r.ok,true);const s=await load(f.outputRoot,r.snapshotPath);assert.deepEqual(s.payload,p);assert.equal(s.status,'CAPTURED');assert.equal(s.capturedAt,now().toISOString());assert.equal(s.payloadSha256,createHash('sha256').update(JSON.stringify(s.payload)).digest('hex'));const a=await load(f.outputRoot,'chat-snapshot/status/latest-attempt.json');assert.equal(a.snapshotPath,r.snapshotPath);assert.equal('payload' in a,false);
});
test('capture does not normalize unavailable schemas, null counts or governance values',async t=>{
 const f=await fixture(t),p={...sample(),schemaReady:false,savedRaceCount:null,formalKpiEligible:true,productionActivationReady:true};delete p.rejectedRowCount;const r=await publishNarStatusSnapshot({...f,fetchImpl:async()=>Response.json(p)});const s=await load(f.outputRoot,r.snapshotPath);assert.deepEqual(s.payload,p);assert.equal(s.payload.savedRaceCount,null);assert.equal('rejectedRowCount' in s.payload,false);
});
test('failed capture preserves the previous validated snapshot and updates failure indexes',async t=>{
 const f=await fixture(t),first=await publishNarStatusSnapshot(f),before=await readFile(path.join(f.outputRoot,first.snapshotPath));const bad=await publishNarStatusSnapshot({...f,fetchImpl:async()=>{throw Error('secret=do-not-copy');}});assert.equal(bad.status,'FAILED');assert.equal(bad.snapshotPath,null);assert.deepEqual(await readFile(path.join(f.outputRoot,first.snapshotPath)),before);const a=await load(f.outputRoot,bad.attemptPath);assert.equal(a.reasonCode,'FETCH_UNAVAILABLE');assert.equal(JSON.stringify(a).includes('secret'),false);assert.equal((await load(f.outputRoot,'chat-snapshot/status/latest-attempt.json')).status,'FAILED');
});
test('first-ever failure records its date without creating a misleading successful snapshot',async t=>{
 const f=await fixture(t),r=await publishNarStatusSnapshot({...f,fetchImpl:async()=>new Response('unavailable',{status:503})});assert.equal(r.ok,false);assert.equal(r.reasonCode,'HTTP_UNAVAILABLE');assert.deepEqual((await readdir(path.join(f.outputRoot,'chat-snapshot/status',date))).sort(),['latest-attempt.json']);
});
test('fixed source URL uses GET, manual redirect handling and no authorization header',async t=>{
 const f=await fixture(t);let calls=0;await publishNarStatusSnapshot({...f,fetchImpl:async(url,options)=>{calls++;assert.equal(url,'https://chass-keiba-lab7.h7625421.workers.dev/api/chass/v1/public/nar-precompute-status?date=2026-10-15&format=compact');assert.equal(options.method,'GET');assert.equal(options.redirect,'manual');assert.deepEqual(options.headers,{accept:'application/json'});return Response.json(sample());}});assert.equal(calls,1);
});
test('redirects, errors and non-JSON documents never become successful snapshots',async t=>{
 const f=await fixture(t);for(const response of [new Response(null,{status:302,headers:{location:'https://example.invalid/'}}),new Response('{}',{status:401}),new Response('<html>error</html>',{headers:{'content-type':'text/html'}})])assert.equal((await publishNarStatusSnapshot({...f,fetchImpl:async()=>response})).status,'FAILED');
});
test('malformed JSON, wrong dates and impossible restored counts fail validation',async t=>{
 const f=await fixture(t);for(const value of ['{',JSON.stringify({...sample(),date:'2026-10-14'}),JSON.stringify({...sample(),savedRaceCount:12}),JSON.stringify({...sample(),rejectedRowCount:-1}),JSON.stringify({...sample(),researchOnly:null})])assert.equal((await publishNarStatusSnapshot({...f,fetchImpl:async()=>new Response(value,{headers:{'content-type':'application/json'}})})).status,'FAILED');
});
test('streaming body size is bounded without trusting Content-Length',async t=>{
 const f=await fixture(t),r=await publishNarStatusSnapshot({...f,fetchImpl:async()=>new Response(' '.repeat(STATUS_BODY_LIMIT+1),{headers:{'content-type':'application/json'}})});assert.equal(r.reasonCode,'BODY_TOO_LARGE');
});
test('declared oversize responses are rejected before body parsing',async t=>{
 const f=await fixture(t),r=await publishNarStatusSnapshot({...f,fetchImpl:async()=>new Response('{}',{headers:{'content-type':'application/json','content-length':String(STATUS_BODY_LIMIT+1)}})});assert.equal(r.reasonCode,'BODY_TOO_LARGE');
});
test('deadline also covers a fetcher that ignores abort signals',async t=>{
 const f=await fixture(t),r=await publishNarStatusSnapshot({...f,timeoutMs:5,fetchImpl:async()=>new Promise(()=>{})});assert.equal(r.reasonCode,'FETCH_TIMEOUT');
});
test('deadline covers body streaming, not only response headers',async t=>{
 const f=await fixture(t),r=await publishNarStatusSnapshot({...f,timeoutMs:5,fetchImpl:async()=>new Response(new ReadableStream({start(){}}),{headers:{'content-type':'application/json'}})});assert.equal(r.reasonCode,'FETCH_TIMEOUT');
});
test('default snapshot date follows JST rather than UTC calendar date',async t=>{
 const f=await fixture(t),r=await publishNarStatusSnapshot({...f,date:undefined,now:()=>new Date('2026-10-14T15:01:00Z')});assert.equal(r.date,'2026-10-15');
});
test('invalid dates and CLI overrides fail before IO or source access',async t=>{
 const f=await fixture(t);let calls=0;for(const d of ['2026-02-30','../../escape','2026-10-15/other'])await assert.rejects(publishNarStatusSnapshot({...f,date:d,fetchImpl:async()=>{calls++;}}),/PUBLISH_CONFIGURATION_INVALID/);assert.equal(calls,0);await assert.rejects(runNarStatusPublisherCli(['--url','https://example.invalid/'],{}),/CLI_ARGUMENTS_UNSUPPORTED/);assert.deepEqual(await readdir(f.outputRoot),[]);
});
test('a later date failure leaves previous date snapshots and the global failure date visible',async t=>{
 const f=await fixture(t),good=await publishNarStatusSnapshot(f),before=await readFile(path.join(f.outputRoot,good.snapshotPath));const r=await publishNarStatusSnapshot({...f,date:'2026-10-16',fetchImpl:async()=>{throw Error();}});assert.equal(r.status,'FAILED');assert.deepEqual(await readFile(path.join(f.outputRoot,good.snapshotPath)),before);assert.equal((await load(f.outputRoot,'chat-snapshot/status/latest-attempt.json')).date,'2026-10-16');
});
test('payload validator accepts confirmed nonzero coverage and rejects non-objects',()=>{
 const p={...sample(),savedRaceCount:1,races:[{raceId:'20261015-NAR-21-01',quality:{probabilityStatus:'MODEL_HOLD'}}]};assert.equal(validateNarStatusPayload(p,date),p);for(const v of [null,[],{},false])assert.throws(()=>validateNarStatusPayload(v,date),/PAYLOAD_INVALID/);
});
async function exerciseWorkflow(t,sourceFails){
 const f=await fixture(t),sandbox=await mkdtemp(path.join(tmpdir(),'chass-mirror-git-'));t.after(()=>rm(sandbox,{recursive:true,force:true}));
 const repo=path.join(sandbox,'work'),remote=path.join(sandbox,'remote.git'),seed=path.join(sandbox,'seed');await mkdir(repo);const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 execFileSync('git',['init','--bare',remote],{stdio:'ignore'});git('init','-b','main');git('config','user.name','Mirror Test');git('config','user.email','mirror@example.invalid');await writeFile(path.join(repo,'code.txt'),'main-code\n');git('add','.');git('commit','-m','main baseline');git('remote','add','origin',remote);git('push','origin','main');const mainBefore=git('rev-parse','main');
 git('checkout','--orphan','chass-data');git('rm','-rf','.');const old=await publishNarStatusSnapshot({...f,outputRoot:seed,now:()=>new Date('2026-10-15T07:00:00Z')});
 const {cp}=await import('node:fs/promises');await cp(path.join(seed,'chat-snapshot'),path.join(repo,'chat-snapshot'),{recursive:true});git('add','.');git('commit','-m','previous valid capture');git('push','origin','chass-data');const prior=await readFile(path.join(repo,old.snapshotPath));git('checkout','main');
 const fresh=await publishNarStatusSnapshot({...f,fetchImpl:sourceFails?async()=>{throw Error('unavailable');}:f.fetchImpl});
 const template=await readFile(new URL('../docs/operations/publish-chass-chat-mirror-phase14012.yml',import.meta.url),'utf8');
 function block(name){const section=template.split('      - name: '+name+'\n')[1];assert.ok(section,name);const tail=section.split('        run: |\n')[1];assert.ok(tail,name);const lines=[];for(const line of tail.split('\n')){if(line.trim()&&!line.startsWith('          '))break;lines.push(line.startsWith('          ')?line.slice(10):'');}return lines.join('\n');}
 const env={...process.env,OUTPUT_ROOT:f.outputRoot,GITHUB_OUTPUT:path.join(sandbox,'github-output'),SNAPSHOT_DATE:date};
 await writeFile(path.join(f.outputRoot,'status-result.json'),JSON.stringify(fresh));
 const captureOutput=block('Capture read-only NAR collection status').replace('node scripts/publish-nar-status-snapshot.mjs | tee "$OUTPUT_ROOT/status-result.json"',':');
 execFileSync('bash',['-e','-c',captureOutput],{cwd:repo,env,stdio:['ignore','pipe','pipe']});
 for(const name of ['Count status and race output independently','Switch safely to dedicated data branch','Copy snapshots and rebuild stable manifest','Validate data-only branch changes','Commit data-only mirror'])execFileSync('bash',['-e','-c',block(name)],{cwd:repo,env,stdio:['ignore','pipe','pipe']});
 assert.equal(git('rev-parse','main'),mainBefore);assert.equal(git('rev-parse','refs/remotes/origin/main'),mainBefore);assert.equal(git('branch','--show-current'),'chass-data');assert.equal(git('status','--porcelain'),'');assert.equal(git('ls-tree','--name-only','HEAD').includes('code.txt'),false);
 const outputs=await readFile(env.GITHUB_OUTPUT,'utf8');assert.ok(outputs.split('\n').includes(`capture_ok=${!sourceFails}`));assert.match(outputs,/count=0/);assert.match(outputs,/has_data=true/);
 const index=await load(repo,'chat-snapshot/status/latest-attempt.json'),manifest=await load(repo,'manifest.json');assert.equal(index.status,sourceFails?'FAILED':'CAPTURED');assert.equal(manifest.statusMirror.latestAttempt.status,index.status);assert.deepEqual(manifest.snapshots,[]);
 if(sourceFails){assert.deepEqual(await readFile(path.join(repo,old.snapshotPath)),prior);assert.throws(()=>execFileSync('bash',['-c',block('Fail visibly after persisting unavailable-source records')],{cwd:repo,env,stdio:'ignore'}));}
 else assert.equal((await load(repo,fresh.snapshotPath)).capturedAt,now().toISOString());
}
test('workflow template publishes a status-only capture to local data branch without changing main',async t=>exerciseWorkflow(t,false));
test('workflow template publishes failure records, retains old snapshot and then signals failure',async t=>exerciseWorkflow(t,true));
