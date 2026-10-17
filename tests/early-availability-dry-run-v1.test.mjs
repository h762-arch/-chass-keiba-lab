import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,symlink,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {evaluateEarlyAvailabilityDryRun as evaluate,runEarlyAvailabilityDryRunCli as cli} from '../scripts/dry-run-early-availability-v1.mjs';

const now=Date.parse('2026-10-17T01:00:00Z');
function fixture(){
 const raceId='20261017-NAR-21-01',race={raceDate:'2026-10-17',track:'川崎',raceNo:1,postTime:'15:00'};
 const horses=[1,2,3,4,5,6].map(horseNo=>({horseNo,horseName:`合成馬${horseNo}`,capturedAt:'2026-10-17T00:00:00Z',sourceRef:'synthetic-reference'}));
 return {raceId,organization:'NAR',dataCalculatedAt:'2026-10-17T00:10:00Z',layers:{
  SOURCE:{raceId,race,horses,acquiredAt:'2026-10-17T00:00:00Z'},DATA:{horses,cpsi:{status:'NOT_APPLICABLE'}},
  MARKET:{acquiredAt:'2026-10-17T00:10:00Z'},FINAL:{createdAt:'2026-10-17T00:10:00Z',ranking:horses.map((h,i)=>({horseNo:h.horseNo,rank:i+1}))},RESULT:null}};
}
const context=()=>({freezeAt:'2026-10-17T00:20:00Z',expectedRunnerCount:6});
const run=(s=fixture(),c=context(),at=now)=>evaluate(JSON.stringify(s),JSON.stringify(c),at);
function assertAuthority(r){
 assert.equal(r.dryRun,true);assert.equal(r.saved,false);assert.equal(r.freezeExecuted,false);
 assert.equal(r.freezeExecutionAuthorized,false);assert.equal(r.earlyFreezeVerified,false);
 assert.equal(r.formalKpiReadiness,'HOLD');assert.equal(r.formalKpiEligible,false);
 assert.equal(r.inputOriginAuthenticated,false);assert.equal(r.probabilityDecision,'MODEL_HOLD');assert.equal(r.productionActivationDecision,'NO-GO');
}
test('current JST prestart DEGRADED is locally assessable with fixed formal HOLD',()=>{const r=run();assert.equal(r.status,'LOCAL_PRESTART_MAPPING_READY');assert.equal(r.mappedPredictionReadiness,'FINAL5_READY_DEGRADED');assertAuthority(r);assert.equal(r.runnerCount,6);assert.equal(r.final5Count,5);});
test('complete declarations can map FULL without gaining freeze authority',()=>{
 const s=fixture(),c=context();for(const h of s.layers.SOURCE.horses)Object.assign(h,{canonicalId:`id-${h.horseNo}`,identitySource:'synthetic-registry',identityVerified:true,evidenceId:`e-${h.horseNo}`,evidenceSource:'synthetic-store',evidenceSavedAt:s.dataCalculatedAt,evidenceReadback:true});
 c.persistenceDeclarations={snapshot:{id:'s',hash:'a'.repeat(64),savedAt:s.dataCalculatedAt,readback:true},early:{freezeId:'f',signalHash:'b'.repeat(64),freezeAt:c.freezeAt,immutable:true,readback:true},readback:{snapshot:true,evidence:true,early:true}};
 const r=run(s,c);assert.equal(r.status,'LOCAL_PRESTART_MAPPING_READY');assert.equal(r.mappedPredictionReadiness,'FINAL5_READY_FULL');assertAuthority(r);
});
for(const [name,at,reason] of [
 ['cutoff not reached',Date.parse('2026-10-17T00:19:59Z'),'CUTOFF_NOT_REACHED'],
 ['at post',Date.parse('2026-10-17T06:00:00Z'),'NOT_PRESTART_AT_OBSERVATION'],
 ['after post',Date.parse('2026-10-17T06:00:01Z'),'NOT_PRESTART_AT_OBSERVATION'],
 ['next JST day',Date.parse('2026-10-17T15:00:00Z'),'NOT_CURRENT_JST_RACE_DATE'],
 ['previous JST day',Date.parse('2026-10-16T14:59:59Z'),'NOT_CURRENT_JST_RACE_DATE']
])test(`${name} holds even when declared snapshot mapping alone could be ready`,()=>{const r=run(fixture(),context(),at);assert.equal(r.status,'HOLD');assert.ok(r.reasons.includes(reason));assertAuthority(r);});
test('JST midnight boundary is distinct from UTC date',()=>{
 const s=fixture(),c=context();s.layers.SOURCE.race.raceDate='2026-10-18';s.raceId=s.layers.SOURCE.raceId='20261018-NAR-21-01';
 for(const h of s.layers.SOURCE.horses)h.capturedAt='2026-10-17T15:00:00Z';s.layers.SOURCE.acquiredAt='2026-10-17T15:00:00Z';
 s.dataCalculatedAt=s.layers.MARKET.acquiredAt=s.layers.FINAL.createdAt='2026-10-17T15:00:01Z';c.freezeAt='2026-10-17T15:00:02Z';
 const r=run(s,c,Date.parse(c.freezeAt));assert.equal(r.observedJstDate,'2026-10-18');assert.equal(r.status,'LOCAL_PRESTART_MAPPING_READY');
});
test('result-bearing snapshot holds without emitting payload or raw declarations',()=>{
 const s=fixture();s.layers.RESULT={finishOrder:[6,5,4],secret:'RESULT_PRIVATE_SENTINEL'};
 s.layers.DATA.privateDiagnostic='DATA_PRIVATE_SENTINEL';const r=run(s);assert.equal(r.status,'HOLD');const raw=JSON.stringify(r);assert.ok(!raw.includes('PRIVATE_SENTINEL'));assert.equal(r.input,undefined);assert.equal(r.layers,undefined);assertAuthority(r);
});
test('missing source timestamps cannot be replaced by observation clock',()=>{const s=fixture();delete s.layers.SOURCE.horses[0].capturedAt;const r=run(s);assert.equal(r.status,'HOLD');assert.ok(r.reasons.includes('CORE_SOURCE_TIME_UNVERIFIED'));});
test('snapshot and context hash bind exact UTF-8 bytes including whitespace',()=>{
 const a=JSON.stringify(fixture()),b=JSON.stringify(context()),r=evaluate(a,b,now),r2=evaluate(a+'\n',b+'\n',now);
 assert.equal(r.snapshotSha256,createHash('sha256').update(a).digest('hex'));assert.equal(r.contextSha256,createHash('sha256').update(b).digest('hex'));assert.notEqual(r.snapshotSha256,r2.snapshotSha256);assert.notEqual(r.contextSha256,r2.contextSha256);assert.equal(r.status,r2.status);
});
test('malformed or oversized input stays HOLD without echoing the input',()=>{for(const x of [null,'[]','{',' '.repeat(1000001)]){const r=evaluate(x,JSON.stringify(context()),now);assert.equal(r.status,'HOLD');assertAuthority(r);}});
test('invalid observation clocks fail closed',()=>{for(const at of [NaN,Infinity,'2026-10-17',now+.1,Number.MAX_SAFE_INTEGER]){const r=run(fixture(),context(),at);assert.equal(r.status,'HOLD');assertAuthority(r);}});

async function files(fn){const dir=await mkdtemp(join(tmpdir(),'chass-early-dry-'));try{await fn(dir);}finally{await rm(dir,{recursive:true,force:true});}}
test('CLI reads the same bytes without modifying either input, even for an old race',async()=>files(async dir=>{
 const s=join(dir,'snapshot.json'),c=join(dir,'context.json'),a=JSON.stringify(fixture()),b=JSON.stringify(context());await writeFile(s,a);await writeFile(c,b);
 const r=await cli(['--context',c,'--snapshot',s]);assert.ok(['HOLD','LOCAL_PRESTART_MAPPING_READY'].includes(r.status));assertAuthority(r);assert.equal(await readFile(s,'utf8'),a);assert.equal(await readFile(c,'utf8'),b);assert.equal(r.snapshotSha256,createHash('sha256').update(a).digest('hex'));
}));
test('CLI rejects replay, output, unknown, duplicate and missing arguments',async()=>{
 for(const args of [[],['--snapshot','a'],['--snapshot','a','--snapshot','b'],['--now','2026-10-17','--context','b'],['--snapshot','a','--output','b'],['--snapshot','a','--context','--help']]){
  const r=await cli(args);assert.equal(r.status,'HOLD');assertAuthority(r);
 }
});
test('CLI missing files do not leak paths or exception text',async()=>{const r=await cli(['--snapshot','/PRIVATE_SENTINEL/missing','--context','/PRIVATE_SENTINEL/missing2']);assert.equal(r.status,'HOLD');assert.ok(!JSON.stringify(r).includes('PRIVATE_SENTINEL'));});
test('CLI rejects directories, symlinks, invalid UTF-8 and oversize files',async()=>files(async dir=>{
 const s=join(dir,'s'),c=join(dir,'c'),link=join(dir,'link'),folder=join(dir,'folder');await writeFile(c,JSON.stringify(context()));await writeFile(s,JSON.stringify(fixture()));await symlink(s,link);await mkdir(folder);
 for(const path of [link,folder])assert.equal((await cli(['--snapshot',path,'--context',c])).status,'HOLD');
 await writeFile(s,Buffer.from([0xff,0xfe]));assert.equal((await cli(['--snapshot',s,'--context',c])).status,'HOLD');
 await writeFile(s,' '.repeat(1000001));assert.equal((await cli(['--snapshot',s,'--context',c])).status,'HOLD');
}));
test('actual node CLI emits bounded JSON and exit 2 on HOLD',()=>{
 const path=fileURLToPath(new URL('../scripts/dry-run-early-availability-v1.mjs',import.meta.url));
 const r=spawnSync(process.execPath,[path,'--now','PRIVATE_SENTINEL'],{encoding:'utf8',timeout:5000});
 assert.equal(r.status,2);assert.equal(r.stderr,'');assertAuthority(JSON.parse(r.stdout));assert.ok(!r.stdout.includes('PRIVATE_SENTINEL'));
});
