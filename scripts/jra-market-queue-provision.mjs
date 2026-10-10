import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {marketQueueReadinessQueries,marketQueueSchemaReadiness} from './jra-market-queue-readiness.mjs';

export const MIGRATION_0013_SHA256='32b4f110f50914a787b94b9f4f38af05681ca90af4a047443fb015f171ead9c6';
const migrationPath=new URL('../migrations/0013_jra_market_queue_audit.sql',import.meta.url);
const fileHash=text=>createHash('sha256').update(text).digest('hex');
export async function provisionMarketQueueAudit({apply=false,sql,config,execute,applyMigration}={}){
 if(typeof apply!=='boolean'||typeof execute!=='function'||typeof sql!=='string'||fileHash(sql)!==MIGRATION_0013_SHA256)throw Error('provision_contract_invalid');
 if(config?.name!=='chass-keiba-lab7'||config?.vars?.ENABLE_JRA_MARKET_QUEUE==='true'||
  config?.d1_databases?.filter(d=>d.binding==='DB').length!==1||
  config?.d1_databases?.filter(d=>d.binding==='DB'&&d.database_name==='chass-keiba-research-db'&&d.database_id==='ea63ed0d-7644-43aa-98f1-684a38dec32f').length!==1)throw Error('provision_configuration_invalid');
 const q=marketQueueReadinessQueries('2026-10-10');
 const inspect=async()=>{const rows=await execute(q.schema),objects=await execute(q.objects);return {shape:marketQueueSchemaReadiness(rows,objects),objects};};
 let before;
 try{before=await inspect();}catch{return {status:'BLOCKED',reason:'SCHEMA_READ_FAILED',applyAttempted:false};}
 if(before.shape.status==='MATCH')return {status:'ALREADY_PROVISIONED',schema:before.shape,applyAttempted:false};
 if(before.shape.status!=='MISSING'||before.objects.length)return {status:'BLOCKED',reason:'SCHEMA_DRIFT_OR_OBJECT_COLLISION',schema:before.shape,applyAttempted:false};
 if(!apply)return {status:'PLAN_ONLY',schema:before.shape,applyAttempted:false,migrationSha256:MIGRATION_0013_SHA256};
 if(typeof applyMigration!=='function')throw Error('provision_apply_unavailable');
 // Only the fixed 0013 file is passed to the executor. No migration sweep,
 // automatic retries, repair, data INSERT, runtime flag change or rollback.
 try{await applyMigration(sql);}catch{return {status:'APPLY_OUTCOME_UNKNOWN',applyAttempted:true,reason:'DO_NOT_RETRY_WITHOUT_SCHEMA_READBACK'};}
 let after;
 try{after=await inspect();}catch{return {status:'APPLIED_UNVERIFIED',applyAttempted:true,reason:'SCHEMA_READBACK_FAILED'};}
 return {status:after.shape.status==='MATCH'?'PROVISIONED':'APPLIED_UNVERIFIED',schema:after.shape,applyAttempted:true,
  migrationSha256:MIGRATION_0013_SHA256,repositoryQueueEnabled:false,runtimeFlagsVerified:false,marketSaved:false,migrationHistoryUpdated:false};
}
function parseRows(raw){const r=JSON.parse(raw);if(!Array.isArray(r)||r.length!==1||r[0]?.success!==true||!Array.isArray(r[0].results))throw Error('invalid_d1_result');return r[0].results;}
export function provisionCliArgs(argv){
 if(argv.length===0)return {apply:false};
 if(argv.length===1&&argv[0]==='--apply-0013')return {apply:true};
 throw Error('use_no_args_or_apply_0013');
}
if(process.argv[1]&&new URL(`file://${process.argv[1]}`).href===import.meta.url){
 try{
  const {apply}=provisionCliArgs(process.argv.slice(2));
  if(!process.env.CLOUDFLARE_API_TOKEN||!process.env.CLOUDFLARE_ACCOUNT_ID||process.env.ENABLE_JRA_MARKET_QUEUE==='true')throw Error('provision_environment_invalid');
  const config=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8')),sql=readFileSync(migrationPath,'utf8');
  const run=args=>execFileSync('npx',['-y','wrangler@4','d1','execute','chass-keiba-research-db','--remote','--json','--config',new URL('../wrangler.jsonc',import.meta.url).pathname,...args],{encoding:'utf8',maxBuffer:20*1024*1024,stdio:['ignore','pipe','pipe']});
  const report=await provisionMarketQueueAudit({apply,sql,config,execute:q=>parseRows(run(['--command',q])),
   applyMigration:approved=>{if(readFileSync(migrationPath,'utf8')!==approved)throw Error('migration_changed');const result=JSON.parse(run(['--file',migrationPath.pathname,'--yes']));if(!Array.isArray(result)||!result.length||result.some(r=>r.success!==true))throw Error('migration_result_unknown');}});
  console.log('MARKET_QUEUE_PROVISION_JSON:'+JSON.stringify(report));
  if(!['PLAN_ONLY','PROVISIONED','ALREADY_PROVISIONED'].includes(report.status))process.exitCode=1;
 }catch{console.error('MARKET_QUEUE_PROVISION_BLOCKED');process.exitCode=1;}
}
