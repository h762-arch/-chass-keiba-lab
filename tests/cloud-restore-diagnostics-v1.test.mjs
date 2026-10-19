import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const plain=x=>JSON.parse(JSON.stringify(x));
function fixture(no=1){const raceId=`2026-10-19|浦和|${no}`,modelVersion='A',race={raceDate:'2026-10-19',track:'浦和',raceNo:no,raceType:'NAR'};return {raceId,record:{race,modelVersion,predictionSnapshot:{raceId,modelVersion,organization:'NAR',race:{...race},createdAt:'2026-10-19T00:00:00Z',horses:[1,2,3].map(horseNo=>({horseNo,horseName:'SYNTHETIC',win:30,place:60,abilityMark:horseNo===1?'◎':''}))},marketSnapshot:{raceId,modelVersion,organization:'NAR',horses:[],signalSnapshot:{status:'frozen',horses:[{horseNo:2,valueMark:'💎'}]}},finalSnapshot:{raceId,modelVersion,organization:'NAR',top3:[{horseNo:1,mark:'◎'}]},resultSnapshot:null,validationSnapshot:null,validated:false,validationCompleted:false}};}
function core(fetchImpl,{memory=new Map(),failStorage=false}={}){
 const nodes=Object.fromEntries(['cloudSource','cloudSyncStatus','cloudSyncButton','cloudRestoreButton','cloudRecheckButton','cloudOperationStatus','cloudSyncHolds','cloudSyncHoldList','cloudSyncHoldCount'].map(id=>[id,{}]));
 const timers=[],window={__CHASS_TEST__:true},context={window,console,Date,Math,JSON,Map,Set,URL,Blob,TextEncoder,structuredClone,Promise,AbortController,fetch:fetchImpl,document:{getElementById:id=>nodes[id]||null},localStorage:{getItem:k=>memory.get(k)??null,setItem:(k,v)=>{if(failStorage&&k!=='chass_cloud_read_operation_v1'&&!k.includes('holds')&&!k.includes('pending'))throw Error('quota');memory.set(k,v)}},setTimeout:fn=>{timers.push(fn);return timers.length},clearTimeout(){},setInterval:()=>{throw Error('NO_INTERVAL')},clearInterval(){}};
 vm.createContext(context);vm.runInContext(source.replace('window.CHASS_TEST={','window.CHASS_TEST={recheckCloudSyncHolds,renderCloudSyncState,runCloudReadAction,getCloudReadOperation:()=>cloneData(cloudReadOperation),getCloudSyncHolds:()=>cloneData(cloudSyncActiveHolds()),setResearchDb:value=>researchDb=value,'),context);
 return {c:window.CHASS_TEST,nodes,timers,memory};
}
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
const dataset=items=>({ok:true,records:items.map(x=>({...x,eligible:true})),counts:null});
function cache(c,items){for(const x of items)c.getRaceCache()[x.raceId]=structuredClone(x.record);}
async function held(c,item){await c.syncRaceToCloud(item.raceId,item.record);assert.equal(c.getCloudSyncHolds().length,1);}
const conflict=item=>({ok:false,error:'SYNC_CONFLICT',records:[{raceId:item.raceId,modelVersion:'A',status:'conflict',error:'PREDICTION_SNAPSHOT_CONFLICT',written:false}]});

test('restore network error remains visible alongside durable holds, with no raw message leak',async()=>{
 const item=fixture(),{c,nodes}=core(async(u)=>{if(u.endsWith('/sync'))return response(conflict(item),409);throw Error('PRIVATE_TOKEN');});cache(c,[item]);await held(c,item);await assert.rejects(c.restoreResearchFromCloud());c.renderCloudSyncState();assert.match(nodes.cloudSyncStatus.textContent,/同期エラー.*同期保留 1件/);assert.match(nodes.cloudOperationStatus.textContent,/復元失敗.*NETWORK_ERROR/);assert.doesNotMatch(nodes.cloudOperationStatus.textContent,/PRIVATE_TOKEN/);assert.equal(c.getCloudSyncHolds().length,1);
});
test('HTTP and malformed JSON failures have safe distinct diagnostics',async()=>{
 for(const [fetchImpl,code] of [[async()=>response({ok:false,error:'PRIVATE'},503),'HTTP_ERROR'],[async()=>new Response('not json'),'INVALID_JSON']]){const {c}=core(fetchImpl);await assert.rejects(c.restoreResearchFromCloud());assert.equal(c.getCloudReadOperation().code,code);}
});
test('body transport failures, aborted reads, and non-JSON HTTP errors are not INVALID_JSON',async()=>{
 for(const [name,status,expected] of [['TypeError',200,'NETWORK_ERROR'],['AbortError',200,'CLOUD_READ_TIMEOUT'],['SyntaxError',503,'HTTP_ERROR']]){
  for(const action of ['restoreResearchFromCloud','recheckCloudSyncHolds']){const {c}=core(async()=>({ok:status===200,status,json:async()=>{const error=new Error('PRIVATE_BODY');error.name=name;throw error;}}));
   await assert.rejects(c[action]());assert.equal(c.getCloudReadOperation().code,expected);
  }
 }
});
test('deadline abort during response body read remains TIMEOUT, not INVALID_JSON',async()=>{
 const {c,timers}=core(async(u,o)=>({ok:true,status:200,json:()=>new Promise((_,reject)=>o.signal.addEventListener('abort',()=>{const e=new Error('PRIVATE');e.name='AbortError';reject(e)}))}));
 const p=c.recheckCloudSyncHolds();await Promise.resolve();await Promise.resolve();timers.at(-1)();await assert.rejects(p);assert.equal(c.getCloudReadOperation().code,'CLOUD_READ_TIMEOUT');
});
test('cloud controls stack status above buttons and cover 440px phone widths',()=>{
 const css=readFileSync(new URL('../styles.css',import.meta.url),'utf8');
 assert.match(css,/\.cloud-sync-bar\{display:grid;grid-template-columns:minmax\(0,1fr\);align-items:stretch\}/);
 assert.match(css,/@media\(max-width:600px\)\{\.cloud-sync-bar \.cloud-sync-actions\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
 assert.match(css,/\.cloud-sync-bar \.cloud-sync-actions button\{width:100%;min-width:0;white-space:normal/);
});
test('known server DB failure codes stay actionable without exposing server detail',async()=>{
 const {c,nodes}=core(async()=>response({ok:false,error:'d1_research_read_failed',detail:'PRIVATE_SQL_OR_TOKEN'},500));await assert.rejects(c.restoreResearchFromCloud());assert.equal(c.getCloudReadOperation().code,'DATABASE_READ_FAILED');assert.match(nodes.cloudOperationStatus.textContent,/読み出せません/);assert.doesNotMatch(nodes.cloudOperationStatus.textContent,/PRIVATE_SQL_OR_TOKEN/);
});
test('timeout ends a stalled restore and re-enables controls',async()=>{
 const {c,nodes,timers}=core(()=>new Promise(()=>{})),p=c.restoreResearchFromCloud();assert.equal(nodes.cloudRestoreButton.disabled,true);assert.equal(nodes.cloudSyncButton.disabled,true);timers.at(-1)();await assert.rejects(p);assert.equal(c.getCloudReadOperation().code,'CLOUD_READ_TIMEOUT');assert.equal(nodes.cloudRestoreButton.disabled,false);assert.equal(nodes.cloudSyncButton.disabled,false);
});
test('invalid or duplicate dataset is rejected before cache mutation',async()=>{
 const item=fixture();for(const body of [{ok:true},{ok:true,records:{}},dataset([item,item]),{ok:true,records:[{raceId:item.raceId,record:null}]}]){const {c}=core(async()=>response(body));cache(c,[item]);const before=plain(c.getRaceCache());await assert.rejects(c.restoreResearchFromCloud());assert.equal(c.getCloudReadOperation().code,'RESTORE_RESPONSE_INVALID');assert.deepEqual(plain(c.getRaceCache()),before);}
});
test('localStorage quota failure never commits staged records or reports success',async()=>{
 const item=fixture(),incoming=structuredClone(item);incoming.record.resultSnapshot={finishOrder:[2,1,3]};const {c}=core(async()=>response(dataset([incoming])),{failStorage:true});cache(c,[item]);const before=plain(c.getRaceCache());await assert.rejects(c.restoreResearchFromCloud());assert.equal(c.getCloudReadOperation().code,'LOCAL_SAVE_FAILED');assert.deepEqual(plain(c.getRaceCache()),before);
});
test('IndexedDB failure keeps original cache and audit untouched',async()=>{
 const item=fixture(),incoming=structuredClone(item);incoming.record.resultSnapshot={finishOrder:[2,1,3]};const {c}=core(async()=>response(dataset([incoming])));cache(c,[item]);c.setResearchDb({transaction(){throw Error('DB_FAILED')}});const before=plain(c.getRaceCache()),audit=plain(c.getCloudAudit());await assert.rejects(c.restoreResearchFromCloud());assert.deepEqual(plain(c.getRaceCache()),before);assert.deepEqual(plain(c.getCloudAudit()),audit);
});
test('restore fills missing result but preserves all original prediction, market signal and final bytes',async()=>{
 const item=fixture(),incoming=structuredClone(item);incoming.record.resultSnapshot={finishOrder:[2,1,3]};const {c,nodes}=core(async()=>response(dataset([incoming])));cache(c,[item]);const r=await c.restoreResearchFromCloud(),saved=plain(c.getRaceCache()[item.raceId]);assert.equal(r.enriched,1);assert.equal(r.resultAdded,1);assert.equal(r.received,1);for(const key of ['predictionSnapshot','marketSnapshot','finalSnapshot'])assert.deepEqual(saved[key],item.record[key]);assert.deepEqual(saved.resultSnapshot.finishOrder,[2,1,3]);assert.match(nodes.cloudOperationStatus.textContent,/結果補完 1件/);
});
test('cloud result without a matching original prediction is quarantined instead of attached to local original',async()=>{
 const item=fixture(),incoming=structuredClone(item);incoming.record.predictionSnapshot=null;incoming.record.resultSnapshot={finishOrder:[2,1,3]};const {c}=core(async()=>response(dataset([incoming])));cache(c,[item]);const r=await c.restoreResearchFromCloud();assert.equal(r.conflicts,1);assert.equal(c.getRaceCache()[item.raceId].cloudConflictReason,'CLOUD_PREDICTION_MISSING');assert.equal(c.getRaceCache()[item.raceId].resultSnapshot,null);assert.deepEqual(plain(c.getRaceCache()[item.raceId].predictionSnapshot),item.record.predictionSnapshot);
});
test('incomplete, duplicate or unknown result horses cannot become a restored validated record',async()=>{
 for(const finishOrder of [[1,2],[1,1,2],[1,2,99]]){const item=fixture(),incoming=structuredClone(item);incoming.record.resultSnapshot={finishOrder};const {c}=core(async()=>response(dataset([incoming])));cache(c,[item]);const r=await c.restoreResearchFromCloud();assert.equal(r.conflicts,1);assert.equal(r.resultAdded,0);assert.equal(c.getRaceCache()[item.raceId].cloudConflictReason,'CLOUD_RESULT_INCOMPLETE');assert.equal(c.getRaceCache()[item.raceId].resultSnapshot,null);}
});
test('zero rows explicitly reports no additions rather than silently claiming restored content',async()=>{
 const {c,nodes}=core(async()=>response(dataset([])));const r=await c.restoreResearchFromCloud();assert.equal(r.received,0);assert.equal(r.enriched,0);assert.match(nodes.cloudOperationStatus.textContent,/受信 0件.*補完 0件/);
});
test('restore completion survives rerender and reload independently from hold count',async()=>{
 const item=fixture();let mode='sync';const first=core(async()=>mode==='sync'?response(conflict(item),409):response(dataset([])));cache(first.c,[item]);await held(first.c,item);mode='restore';await first.c.restoreResearchFromCloud();first.c.renderCloudSyncState();assert.match(first.nodes.cloudOperationStatus.textContent,/復元完了/);assert.match(first.nodes.cloudSyncStatus.textContent,/同期保留 1件/);const second=core(()=>{throw Error('NO_NETWORK')},{memory:first.memory});second.c.renderCloudSyncState();assert.match(second.nodes.cloudOperationStatus.textContent,/復元完了/);assert.equal(second.c.getCloudSyncHolds().length,1);
});
test('interrupted saved operation never renders as completed after reload',()=>{
 const memory=new Map([['chass_cloud_read_operation_v1',JSON.stringify({action:'restore',status:'running',phase:'save',startedAt:'2026-10-19T00:00:00Z'})]]),{c,nodes}=core(()=>{throw Error()},{memory});c.renderCloudSyncState();assert.match(nodes.cloudOperationStatus.textContent,/完了を確認できません/);assert.doesNotMatch(nodes.cloudOperationStatus.textContent,/復元完了/);
});
test('read-only recheck clears only exact fresh manifest matches and never sends POST',async()=>{
 const a=fixture(),b=fixture(2),calls=[];let mode='sync';const {c}=core(async(u,o)=>{calls.push([u,o.method||'GET']);if(mode==='sync')return response(conflict(JSON.parse(o.body).records[0]),409);return response({ok:true,records:[c.cloudDescriptor(a.raceId,a.record)]});});cache(c,[a,b]);await c.syncRaceToCloud(a.raceId,a.record);await c.syncRaceToCloud(b.raceId,b.record);mode='recheck';calls.length=0;const result=await c.recheckCloudSyncHolds();assert.deepEqual(plain(result),{checked:2,cleared:1,remaining:1});assert.deepEqual(calls,[['/api/db/manifest','GET']]);assert.equal(c.getCloudSyncHolds()[0].raceId,b.raceId);
});
test('duplicate manifest, wrong model, and snapshot disagreement cannot release a hold',async()=>{
 for(const kind of ['duplicate','model','different']){const item=fixture();let mode='sync';const {c}=core(async()=>{if(mode==='sync')return response(conflict(item),409);const desc=plain(c.cloudDescriptor(item.raceId,item.record));if(kind==='model')desc.modelVersion='B';if(kind==='different')desc.resultFingerprint='other';return response({ok:true,records:kind==='duplicate'?[desc,desc]:[desc]});});cache(c,[item]);await held(c,item);mode='recheck';if(kind==='duplicate')await assert.rejects(c.recheckCloudSyncHolds());else await c.recheckCloudSyncHolds();assert.equal(c.getCloudSyncHolds().length,1);}
});
test('local race binding inconsistency cannot be released by matching fingerprints',async()=>{
 const item=fixture();item.record.race.raceId='2026-10-19|浦和|9';let mode='sync';const {c}=core(async()=>mode==='sync'?response(conflict(item),409):response({ok:true,records:[c.cloudDescriptor(item.raceId,item.record)]}));cache(c,[item]);await held(c,item);mode='recheck';const result=await c.recheckCloudSyncHolds();assert.equal(result.cleared,0);assert.equal(result.remaining,1);
});
test('restore keeps differing originals quarantined without clearing their existing hold',async()=>{
 const item=fixture(),incoming=structuredClone(item);incoming.record.predictionSnapshot.horses[0].win=99;let mode='sync';const {c}=core(async()=>mode==='sync'?response(conflict(item),409):response(dataset([incoming])));cache(c,[item]);await held(c,item);mode='restore';const r=await c.restoreResearchFromCloud();assert.equal(r.conflicts,1);assert.deepEqual(plain(c.getRaceCache()[item.raceId].predictionSnapshot),item.record.predictionSnapshot);assert.equal(c.getCloudSyncHolds().length,1);
});
test('simultaneous restores share one GET and keep controls busy through completion',async()=>{
 let release,calls=0;const gate=new Promise(r=>release=r),{c,nodes}=core(async()=>{calls++;await gate;return response(dataset([]))});const a=c.restoreResearchFromCloud(),b=c.restoreResearchFromCloud();assert.equal(a,b);assert.equal(nodes.cloudRestoreButton.disabled,true);assert.equal(nodes.cloudRecheckButton.disabled,true);release();await a;assert.equal(calls,1);assert.equal(nodes.cloudRestoreButton.disabled,false);assert.equal(nodes.cloudRecheckButton.disabled,false);
});
test('newer local revision during IndexedDB persistence survives and is counted as deferred',async()=>{
 const item=fixture(),incoming=structuredClone(item);incoming.record.resultSnapshot={finishOrder:[2,1,3]};const {c}=core(async()=>response(dataset([incoming])));cache(c,[item]);const tx={objectStore(){return {put(){}}}};c.setResearchDb({transaction:()=>tx});const p=c.restoreResearchFromCloud();for(let i=0;i<20&&!tx.oncomplete;i++)await Promise.resolve();assert.equal(typeof tx.oncomplete,'function');c.getRaceCache()[item.raceId]={...c.getRaceCache()[item.raceId],predictionSnapshot:{...item.record.predictionSnapshot,horses:[{horseNo:1,win:99}]}};tx.oncomplete();const r=await p;assert.equal(c.getRaceCache()[item.raceId].predictionSnapshot.horses[0].win,99);assert.equal(r.deferred,1);assert.equal(r.enriched,0);assert.equal(c.getCloudReadOperation().status,'partial');
});
test('new backups include diagnostic state without replaying it as imported holds',async()=>{
 const item=fixture(),{c}=core(async()=>response(conflict(item),409));cache(c,[item]);await held(c,item);const backup=plain(c.createResearchBackup());assert.equal(backup.syncDiagnostics.schemaVersion,1);assert.equal(backup.syncDiagnostics.holds.length,1);assert.deepEqual(backup.races[item.raceId].predictionSnapshot,item.record.predictionSnapshot);const fresh=core(()=>{throw Error('NO_NETWORK')});fresh.c.mergeResearchBackup(backup);assert.equal(fresh.c.getCloudSyncHolds().length,0);
});
test('UI render failure after saved restore keeps success counts and reports render problem',async()=>{
 const {c,nodes}=core(async()=>response(dataset([])));await c.runCloudReadAction('restore');assert.equal(c.getCloudReadOperation().code,'RENDER_FAILED');assert.match(nodes.cloudOperationStatus.textContent,/保存は完了.*画面更新/);
});
test('recheck and restore are blocked while a cloud POST is in flight',async()=>{
 for(const action of ['restoreResearchFromCloud','recheckCloudSyncHolds']){const item=fixture();let release;const gate=new Promise(r=>release=r),calls=[];const {c}=core(async(u,o)=>{calls.push(u);await gate;return response(conflict(item),409);});cache(c,[item]);const p=c.syncRaceToCloud(item.raceId,item.record);await Promise.resolve();await assert.rejects(c[action]());assert.equal(c.getCloudReadOperation().code,'CLOUD_SYNC_BUSY');assert.deepEqual(calls,['/api/db/sync']);release();await p;}
});
test('automatic local save during a read operation remains pending instead of sending concurrently',async()=>{
 const item=fixture(),calls=[];let release;const gate=new Promise(r=>release=r),{c}=core(async(u,o)=>{calls.push([u,o.method||'GET']);await gate;return response(dataset([]));});cache(c,[item]);const p=c.restoreResearchFromCloud();const saved=await c.syncRaceToCloud(item.raceId,item.record);assert.equal(saved,false);assert.deepEqual(calls,[['/api/db/research','GET']]);assert.equal(c.getCloudState().pending,1);release();await p;assert.equal(c.getCloudState().pending,1);
});
