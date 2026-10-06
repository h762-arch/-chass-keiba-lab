import {readFileSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {extractFrozenSignalsFromBackup} from '../src/research/signal-backup-reader.mjs';
import {auditFrozenSignalCohort} from '../src/research/signal-rule-cohort-audit.mjs';
import {JRA_EARLY_CALCULATION_VERSION,JRA_EARLY_MODEL_VERSION} from '../src/prediction/jra-early-research-reader.mjs';
const reject=reason=>({status:'REJECTED',reason,queries:null,formalKpiEligible:false,productionActivationReady:false});
const literal=value=>`'${value.replaceAll("'","''")}'`;

// Prepare SELECT text only. No D1 connection, execution, input mutation or signal creation.
export function runFrozenSignalExportPlanCli(args){
 const options={},keys=new Set(['--backup','--race-ids']);
 for(let i=0;i<args.length;i+=2){
  if(!keys.has(args[i])||Object.hasOwn(options,args[i])||!args[i+1]||args[i+1].startsWith('--'))return reject('INVALID_CLI_ARGUMENTS');
  options[args[i]]=args[i+1];
 }
 if(Object.keys(options).length!==2)return reject('INVALID_CLI_ARGUMENTS');
 let bytes,backup;
 try{
  const stat=statSync(options['--backup']);
  if(!stat.isFile()||stat.size>32*1024*1024)throw Error('invalid file');
  bytes=readFileSync(options['--backup']);backup=JSON.parse(bytes.toString('utf8'));
 }catch{return reject('BACKUP_FILE_READ_FAILED');}
 const extracted=extractFrozenSignalsFromBackup(backup,options['--race-ids'].split(','));
 if(extracted.status!=='READY')return reject(extracted.reason);
 const races=[];
 for(const {raceId,record} of extracted.entries){
  const match=/^(\d{4})(\d{2})(\d{2})-JRA-(.+)-(\d{2})$/.exec(raceId);
  if(!match||Number(match[5])>12||/[\x00-\x1f\x7f|]/.test(match[4]))return reject('INVALID_JRA_RACE_ID');
  if((record.raceId!=null&&record.raceId!==raceId)||(record.marketSnapshot?.raceId!=null&&record.marketSnapshot.raceId!==raceId))
   return reject('SIGNAL_RACE_IDENTITY_MISMATCH');
  const date=`${match[1]}-${match[2]}-${match[3]}`,track=match[4],raceNo=Number(match[5]);
  races.push({raceId,date,track,raceNo,resultCacheKey:`result|${date}|${track}|${raceNo}`});
 }
 const audit=auditFrozenSignalCohort(extracted.entries);
 if(audit.status!=='READY')return reject(audit.reason);
 return {status:'READY',reason:null,evidenceSchemaVersion:'CHASS-SIGNAL-EXPORT-PLAN-1',
  scope:'LOCAL_BACKUP_SELECT_PLAN',inputProvenance:'LOCAL_FILES_NOT_AUTHENTICATED',
  backupSha256:createHash('sha256').update(bytes).digest('hex'),requestedRaceIds:races.map(r=>r.raceId),races,
  calculationVersion:JRA_EARLY_CALCULATION_VERSION,modelVersion:JRA_EARLY_MODEL_VERSION,
  signalAudit:audit.summary,formalKpiEligible:false,productionActivationReady:false,
  queries:{
   snapshots:`SELECT organization,race_id,revision,source_validated_at,data_calculated_at,calculated_at,calculation_version,model_version,status,data_json FROM precomputed_race_snapshots WHERE organization='JRA' AND race_id IN (${races.map(r=>literal(r.raceId)).join(',')}) AND calculation_version=${literal(JRA_EARLY_CALCULATION_VERSION)} AND model_version=${literal(JRA_EARLY_MODEL_VERSION)} AND data_json IS NOT NULL AND data_json<>'' ORDER BY race_id,revision ASC;`,
   results:`SELECT organization,race_date,track,race_no,payload_json,fetched_at FROM jra_official_cache WHERE kind='result' AND organization='JRA' AND cache_key IN (${races.map(r=>literal(r.resultCacheKey)).join(',')});`
  }};
}
// stdout JSON; exit 0 plan generated (not evidence collected), 1 rejected. No network or writes.
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 const result=runFrozenSignalExportPlanCli(process.argv.slice(2));
 console.log(JSON.stringify(result,null,2));process.exitCode=result.status==='READY'?0:1;
}
