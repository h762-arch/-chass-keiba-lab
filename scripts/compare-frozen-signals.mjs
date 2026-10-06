import {readFileSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {extractFrozenSignalsFromBackup} from '../src/research/signal-backup-reader.mjs';
import {isFrozenSignalRaceId} from '../src/research/signal-rule-cohort-audit.mjs';
import {readJraSignalOutcomeCohort} from '../src/research/jra-signal-outcome-reader.mjs';
const fail=reason=>({status:'REJECTED',reason,summary:null,productionActivationReady:false});
const snapshotSql='SELECT organization,race_id,revision,source_validated_at,data_calculated_at,calculated_at,calculation_version,model_version,status,data_json FROM precomputed_race_snapshots WHERE organization=? AND race_id=? AND calculation_version=? AND model_version=? AND data_json IS NOT NULL AND data_json<>\'\' ORDER BY revision ASC LIMIT 1';
const resultSql="SELECT organization,race_date,track,race_no,payload_json,fetched_at FROM jra_official_cache WHERE kind='result' AND cache_key=?";
const text=v=>typeof v==='string'&&v.length>0;
const resultKey=r=>`result|${r.race_date}|${r.track}|${r.race_no}`;

// Cache file: {schemaVersion:'CHASS-JRA-SIGNAL-CACHE-1',snapshotRows:[D1 rows],resultRows:[D1 rows]}.
// Local files are not authenticated Production evidence. Preserve earliest-row SQL semantics, including bad DATA.
export function createOfflineSignalOutcomeDb(input){
 if(input?.schemaVersion!=='CHASS-JRA-SIGNAL-CACHE-1'||!Array.isArray(input.snapshotRows)||
  !Array.isArray(input.resultRows)||input.snapshotRows.length>1000||input.resultRows.length>100)
  throw Error('CACHE_INPUT_INVALID');
 const c=structuredClone(input),ids=c.snapshotRows.map(r=>JSON.stringify([r?.race_id,r?.revision,r?.calculation_version,r?.model_version]));
 if(c.snapshotRows.some(r=>r?.organization!=='JRA'||!isFrozenSignalRaceId(r.race_id)||!r.race_id.includes('-JRA-')||
  Number(r.race_id.slice(-2))>12||!Number.isInteger(r.revision)||r.revision<1||!text(r.calculation_version)||!text(r.model_version))||
  new Set(ids).size!==ids.length||c.resultRows.some(r=>r?.organization!=='JRA'||
   typeof r.race_date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(r.race_date)||!text(r.track)||r.track.includes('|')||
   !Number.isInteger(r.race_no)||r.race_no<1||r.race_no>12||
   !isFrozenSignalRaceId(`${r.race_date.replaceAll('-','')}-JRA-${r.track}-${String(r.race_no).padStart(2,'0')}`))||
  new Set(c.resultRows.map(resultKey)).size!==c.resultRows.length)throw Error('CACHE_INPUT_INVALID');
 return {prepare(sql){
  const normalized=String(sql).replace(/\s+/g,' ').trim(),kind=normalized===snapshotSql?'snapshot':normalized===resultSql?'result':null;
  if(!kind)throw Error('OFFLINE_QUERY_NOT_ALLOWED');
  return {bind(...args){
   if(!args.every(v=>typeof v==='string')||(kind==='snapshot'&&(args.length!==4||args[0]!=='JRA'))||
    (kind==='result'&&args.length!==1))throw Error('OFFLINE_BIND_INVALID');
   return {async first(){
    if(kind==='snapshot')return c.snapshotRows.filter(r=>r.organization===args[0]&&r.race_id===args[1]&&
     r.calculation_version===args[2]&&r.model_version===args[3]&&r.data_json!=null&&r.data_json!=='')
     .sort((a,b)=>a.revision-b.revision)[0]??null;
    return c.resultRows.find(r=>resultKey(r)===args[0])??null;
   }};
  }};
 }};
}

function readInput(file){
 const stat=statSync(file);if(!stat.isFile()||stat.size>32*1024*1024)throw Error('INPUT_FILE_READ_FAILED');
 const bytes=readFileSync(file);return {data:JSON.parse(bytes.toString('utf8')),sha256:createHash('sha256').update(bytes).digest('hex')};
}
function validClock(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value))return false;
 const day=value.slice(0,10),stamp=Date.parse(`${day}T00:00:00Z`);
 return Number.isFinite(stamp)&&new Date(stamp).toISOString().slice(0,10)===day&&Number.isFinite(Date.parse(value));
}
// Usage: node scripts/compare-frozen-signals.mjs --backup backup.json --cache cache.json --race-ids ID1,ID2 --now 2026-10-10T03:00:00Z
// stdout JSON only; exit 1 invalid/blocked, 2 incomplete observations, 0 research comparison complete (not readiness).
export async function runFrozenSignalComparisonCli(args){
 const keys=new Set(['--backup','--cache','--race-ids','--now']),options={};
 for(let i=0;i<args.length;i+=2){
  if(!keys.has(args[i])||Object.hasOwn(options,args[i])||!args[i+1]||args[i+1].startsWith('--'))return fail('INVALID_CLI_ARGUMENTS');
  options[args[i]]=args[i+1];
 }
 if(Object.keys(options).length!==4||!validClock(options['--now']))return fail('INVALID_CLI_ARGUMENTS');
 let backup,cache;
 try{backup=readInput(options['--backup']);cache=readInput(options['--cache']);}catch{return fail('INPUT_FILE_READ_FAILED');}
 const extracted=extractFrozenSignalsFromBackup(backup.data,options['--race-ids'].split(','));
 if(extracted.status!=='READY')return extracted;
 let DB;try{DB=createOfflineSignalOutcomeDb(cache.data);}catch{return fail('CACHE_INPUT_INVALID');}
 const result=await readJraSignalOutcomeCohort({DB,entries:extracted.entries,now:Date.parse(options['--now'])});
 return {...result,inputProvenance:'LOCAL_FILES_NOT_AUTHENTICATED',backupSha256:backup.sha256,cacheSha256:cache.sha256,
  evidenceSchemaVersion:'CHASS-SIGNAL-COMPARISON-1',evaluationNow:new Date(Date.parse(options['--now'])).toISOString(),
  requestedRaceIds:extracted.entries.map(e=>e.raceId)};
}
export function frozenSignalComparisonExitCode(result){
 if(result.status!=='READY')return 1;
 const s=result.summary;
 return s.excludedRaceCount||s.excludedHorseCount||s.observedHorseCount===0?2:0;
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 const result=await runFrozenSignalComparisonCli(process.argv.slice(2));
 console.log(JSON.stringify(result,null,2));process.exitCode=frozenSignalComparisonExitCode(result);
}
