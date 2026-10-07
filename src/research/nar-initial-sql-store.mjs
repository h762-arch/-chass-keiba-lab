import {verifyNarInitialResearchBundle} from './nar-initial-research-bundle.mjs';
// Explicit local/research setup only. No automatic migration or D1 bindings.
export const NAR_INITIAL_RESEARCH_SCHEMA_SQL=`CREATE TABLE IF NOT EXISTS research_nar_initial_bundles (
 storage_key TEXT PRIMARY KEY NOT NULL,
 snapshot_json TEXT NOT NULL
);`;
const queues=new WeakMap();
async function serial(db,work){const prior=queues.get(db)||Promise.resolve();let release;const next=new Promise(r=>release=r);queues.set(db,next);await prior;try{return await work()}finally{release();if(queues.get(db)===next)queues.delete(db)}}
function identify(key){const m=typeof key==='string'&&key.match(/^(nar-early:v1:|nar-initial-research:v1:)(\d{4}-\d{2}-\d{2}\|[^|]+\|[1-9]\d?)$/);return m?{raceId:m[2],table:m[1]==='nar-early:v1:'?'research_nar_early_snapshots':'research_nar_initial_bundles'}:null}
// db.exec(sql), db.first(sql,args), db.run(sql,args) share ONE dedicated
// SQLite connection. run returns {changes}. Use no unrelated work on that connection.
export function createNarInitialSqlStore({db,mode='off',clock=Date.now}={}){
 if(!['off','read-only','research-write'].includes(mode))throw Error('BUNDLE_SQL_MODE_INVALID');
 function guard(key,write=false){const id=identify(key);if(mode==='off'||write&&mode!=='research-write')throw Error('BUNDLE_SQL_DISABLED');if(!id||typeof db?.exec!=='function'||typeof db.first!=='function'||typeof db.run!=='function'||typeof clock!=='function')throw Error('BUNDLE_SQL_CONTRACT_INVALID');return id}
 return Object.freeze({
  async get(key){const id=guard(key);return serial(db,async()=>{const row=await db.first(`SELECT snapshot_json FROM ${id.table} WHERE storage_key = ?`,[key]);if(row===null)return null;if(typeof row?.snapshot_json!=='string')throw Error('BUNDLE_SQL_ROW_INVALID');return row.snapshot_json})},
  async insertBundleIfBothAbsent(legacyKey,bundleKey,json,limits){
   const id=guard(bundleKey,true),legacy=guard(legacyKey,true);
   if(id.table!=='research_nar_initial_bundles'||legacy.table!=='research_nar_early_snapshots'||id.raceId!==legacy.raceId||typeof json!=='string')throw Error('BUNDLE_SQL_KEY_PAIR_INVALID');
   if(!limits||!['notAfter','acquiredAt','maxAgeMs','notBefore'].every(k=>Number.isFinite(limits[k]))||limits.maxAgeMs!==60000)throw Error('BUNDLE_SQL_LIMITS_INVALID');
   const saved=JSON.parse(json),verified=await verifyNarInitialResearchBundle(saved,{raceId:id.raceId});
   if(verified.status!=='PRESERVED'||Date.parse(saved.acquiredAt)!==limits.acquiredAt||Date.parse(saved.sealedAt)>limits.notBefore||limits.notBefore<limits.acquiredAt||Date.parse(`${saved.sourceEarlySnapshot.data.race.raceDate}T${saved.sourceEarlySnapshot.data.race.postTime}:00+09:00`)!==limits.notAfter)throw Error('BUNDLE_SQL_SNAPSHOT_INVALID');
   return serial(db,async()=>{
    let active=false,last=null;
    function deadline(){const t=clock();if(!Number.isFinite(t)||t<limits.notBefore||t>=limits.notAfter||t-limits.acquiredAt>limits.maxAgeMs||last!==null&&t<last)throw Error('BUNDLE_SQL_DEADLINE');last=t}
    try{
     await db.exec('BEGIN IMMEDIATE');active=true;
     // Both namespaces are inspected while SQLite holds the same writer lock.
     const old=await db.first('SELECT snapshot_json FROM research_nar_early_snapshots WHERE storage_key = ?',[legacyKey]);
     const current=await db.first('SELECT snapshot_json FROM research_nar_initial_bundles WHERE storage_key = ?',[bundleKey]);
     if(old!==null||current!==null){await db.exec('ROLLBACK');active=false;return false}
     deadline();
     const result=await db.run('INSERT INTO research_nar_initial_bundles (storage_key,snapshot_json) VALUES (?,?)',[bundleKey,json]);
     if(result?.changes!==1)throw Error('BUNDLE_SQL_INSERT_UNCONFIRMED');
     // Late/expired execution rolls the uncommitted insert back.
     deadline();await db.exec('COMMIT');active=false;return true;
    }catch(error){if(active){try{await db.exec('ROLLBACK')}catch{throw Error('BUNDLE_SQL_ROLLBACK_FAILED')}}throw error}
   });
  }
 });
}
