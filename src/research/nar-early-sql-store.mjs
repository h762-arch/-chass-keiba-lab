import {verifyNarEarlySnapshot} from './nar-early-freeze.mjs';

// Exported schema is for explicit local/research setup only. Never auto-migrate.
export const NAR_EARLY_RESEARCH_SCHEMA_SQL=`CREATE TABLE IF NOT EXISTS research_nar_early_snapshots (
 storage_key TEXT PRIMARY KEY NOT NULL,
 snapshot_json TEXT NOT NULL
);`;
const raceFor=key=>typeof key==='string'&&/^nar-early:v1:\d{4}-\d{2}-\d{2}\|[^|]+\|[1-9]\d?$/.test(key)?key.slice('nar-early:v1:'.length):null;
// Inject prepare(sql).bind(...).first()/run(); run must report meta.changes.
// No Worker bindings, routes, production flags or automatic schema creation.
export function createNarEarlySqlStore({db,mode='off'}={}){
 if(!['off','read-only','research-write'].includes(mode))throw Error('EARLY_SQL_MODE_INVALID');
 function guard(key,write=false){
  const raceId=raceFor(key);
  if(mode==='off'||(write&&mode!=='research-write'))throw Error('EARLY_SQL_DISABLED');
  if(!raceId||typeof db?.prepare!=='function')throw Error('EARLY_SQL_CONTRACT_INVALID');
  return raceId;
 }
 return Object.freeze({
  async get(key){
   guard(key);
   const row=await db.prepare('SELECT snapshot_json FROM research_nar_early_snapshots WHERE storage_key = ?').bind(key).first();
   if(row===null)return null;
   if(typeof row?.snapshot_json!=='string')throw Error('EARLY_SQL_ROW_INVALID');
   return row.snapshot_json;
  },
  async insertIfAbsent(key,json){
   const raceId=guard(key,true);
   if(typeof json!=='string')throw Error('EARLY_SQL_JSON_INVALID');
   const checked=await verifyNarEarlySnapshot(JSON.parse(json),{raceId});
   if(checked.status!=='PRESERVED')throw Error('EARLY_SQL_SNAPSHOT_INVALID');
   const result=await db.prepare('INSERT INTO research_nar_early_snapshots (storage_key, snapshot_json) VALUES (?, ?) ON CONFLICT(storage_key) DO NOTHING').bind(key,json).run();
   if(result?.success!==true||![0,1].includes(result?.meta?.changes))throw Error('EARLY_SQL_WRITE_UNCONFIRMED');
   return result.meta.changes===1;
  }
 });
}
