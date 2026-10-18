import {createHash} from 'node:crypto';
import {openQuiescentResearchSqliteV1,localResearchSqlitePath,ResearchSqliteGuardError} from './research-sqlite-readonly-v1.mjs';
import {summarizeEarlyEvidenceCohort,earlyEvidenceCohortRejection} from './early-kpi-cohort-v1.mjs';
import {earlyEvidenceTime} from '../prediction/jra-early-research-reader.mjs';

export const VERSION='CHASS_EARLY_OUTCOME_SQLITE_AUDIT_V1';
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const hash=s=>createHash('sha256').update(s,'utf8').digest('hex');
const base=()=>({version:VERSION,researchOnly:true,acquisitionPerformed:false,storageWritesPerformed:false,
 sourceOriginAuthenticated:false,resultOriginAuthenticated:false,externalAnchorAuthenticated:false,trustedDurableTime:false,
 crossDatabaseAtomicSnapshot:false,formalKpiEligible:false,formalKpiReadiness:'HOLD',probabilityDecision:'MODEL_HOLD',productionActivationDecision:'NO-GO'});
const hold=reason=>freeze({...base(),status:'HOLD',reason,report:null});
const own=(v,k)=>Object.hasOwn(v,k);
function config(raw){
 if(typeof raw!=='string'||Buffer.byteLength(raw)>32768)throw Error();
 const c=JSON.parse(raw);if(!c||typeof c!=='object'||Array.isArray(c)
  ||Object.keys(c).some(k=>!['evidenceDbPath','resultsDbPath','targets','evaluatedAt'].includes(k))
  ||!['evidenceDbPath','resultsDbPath','targets','evaluatedAt'].every(k=>own(c,k)))throw Error();
 c.evidenceDbPath=localResearchSqlitePath(c.evidenceDbPath);c.resultsDbPath=localResearchSqlitePath(c.resultsDbPath);
 c.now=earlyEvidenceTime(c.evaluatedAt);if(!Number.isFinite(c.now))throw Error();
 const reason=earlyEvidenceCohortRejection(c.targets,c.now);if(reason)throw Error(reason);
 return c;
}
function requireTables(db,tables){
 for(const table of tables){const row=db.prepare('SELECT type FROM sqlite_schema WHERE name=?').get(table);
  if(row?.type!=='table')throw new ResearchSqliteGuardError('REQUIRED_TABLE_MISSING_OR_VIEW');
  const keys=table==='precomputed_race_snapshots'?['organization','race_id','revision']:table==='jra_official_cache'?['cache_key']:table==='races'?['race_id','model_version']:['storage_key'];
  const indexes=db.prepare('SELECT name FROM pragma_index_list(?) WHERE "unique"=1 AND partial=0').all(table);
  if(!indexes.some(i=>{const columns=db.prepare('SELECT name FROM pragma_index_info(?) ORDER BY seqno').all(i.name).map(x=>x.name);
   return columns.length===keys.length&&keys.every(k=>columns.includes(k));}))throw new ResearchSqliteGuardError('REQUIRED_UNIQUE_KEYS_MISSING');
 }
}
// Explicit local copies only. Reuses the merged common reader; no new prediction,
// result reconstruction, SQL supplied by the caller, discovery, network or writer.
export async function auditEarlyOutcomeSqliteV1(configJson){
 let c;try{c=config(configJson);}catch{return hold('INVALID_AUDIT_CONFIG');}
 const leases=new Map();let queryCount=0;
 try{
  for(const path of new Set([c.evidenceDbPath,c.resultsDbPath]))leases.set(path,openQuiescentResearchSqliteV1(path,{hashBytes:true}));
  const evidence=leases.get(c.evidenceDbPath),results=leases.get(c.resultsDbPath),orgs=new Set(c.targets.map(t=>t.organization));
  if(orgs.has('JRA')){requireTables(evidence.db,['precomputed_race_snapshots']);requireTables(results.db,['jra_official_cache']);}
  if(orgs.has('NAR')){requireTables(evidence.db,['research_nar_early_snapshots','research_nar_initial_bundles','research_nar_commit_observations']);requireTables(results.db,['races']);}
  const DB={prepare(sql){
   if(typeof sql!=='string'||!/^SELECT\b/.test(sql)||/;/.test(sql))throw Error('SELECT_ONLY');
   const table=/\bFROM\s+([a-z_]+)/i.exec(sql)?.[1];
   const db=['precomputed_race_snapshots','research_nar_early_snapshots','research_nar_initial_bundles','research_nar_commit_observations'].includes(table)?evidence.db
    :['jra_official_cache','races'].includes(table)?results.db:null;
   if(!db)throw Error('UNRECOGNIZED_READER_QUERY');
   // Bound JRA text before JS materialization too; original values are never
   // repaired. Oversized values become null and fail the existing reader.
   const bounded=table==='precomputed_race_snapshots'?sql.replace(/\bdata_json\b/,'CASE WHEN length(CAST(data_json AS BLOB)) BETWEEN 1 AND 1000000 THEN data_json END AS data_json')
    :table==='jra_official_cache'?sql.replace(/\bpayload_json\b/,'CASE WHEN length(CAST(payload_json AS BLOB)) BETWEEN 1 AND 1000000 THEN payload_json END AS payload_json'):sql;
   // LIMIT 2 detects duplicate matching keys without fetching an unbounded set.
   const statement=db.prepare('SELECT * FROM ('+bounded+') LIMIT 2');
   return {bind(...args){return {async first(){queryCount++;const rows=statement.all(...args);if(rows.length>1)throw Error('DUPLICATE_READER_ROWS');return rows[0]||null;}};}};
  }};
  const cohort=await summarizeEarlyEvidenceCohort({DB,targets:c.targets,now:c.now});
  for(const lease of leases.values())lease.close();
  for(const lease of leases.values())lease.assertStable();
  if(cohort.status!=='READ_COMPLETE')return hold('COHORT_READ_REJECTED');
  return freeze({...base(),status:'READ_COMPLETE',reason:null,evaluatedAt:c.evaluatedAt,
   clockAuthority:'CALLER_DECLARED_EVALUATION_TIME',assessmentBasis:'EXPLICIT_STABLE_LOCAL_SQLITE_COPIES_AND_EXISTING_ROW_READERS',
   evidenceFile:evidence.fingerprint,resultsFile:results.fingerprint,
   targetsUtf8Sha256:hash(JSON.stringify(c.targets)),queryCount,filesUnchanged:true,report:cohort.report});
 }catch(error){return hold(error instanceof ResearchSqliteGuardError?error.code:'SQLITE_AUDIT_FAILED');}
 finally{for(const lease of leases.values())try{lease.close();}catch{}}
}
