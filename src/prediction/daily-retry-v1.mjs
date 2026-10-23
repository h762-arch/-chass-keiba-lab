/** Explicit research attempts; scheduled evidence is never overwritten. */
import {cpsiDriveReaderAuthorized} from './cpsi-drive-reader-v1.mjs';
import {jstDate} from './daily-analysis-v1.mjs';
export const DAILY_RETRY_PATH='/api/chass/v1/research/daily/retry';
export const retryPrefix=date=>'DAILY_RETRY_V1:'+date+':';
export const validRetryId=(id,date)=>typeof id==='string'&&id.startsWith(retryPrefix(date))&&/^DAILY_RETRY_V1:\d{4}-\d{2}-\d{2}:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id);
const json=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'private, no-store','vary':'Authorization, Cookie, Origin','x-content-type-options':'nosniff'}});
export async function handleDailyRetryRequest(request,env={},options={}){
 const u=new URL(request.url);if(u.pathname!==DAILY_RETRY_PATH)return null;
 if(request.method!=='POST')return json({ok:false,code:'DAILY_METHOD_NOT_ALLOWED'},405);
 if(u.protocol!=='https:'||request.headers.get('origin')!==u.origin)return json({ok:false,code:'DAILY_ORIGIN_FORBIDDEN'},403);
 try{
  if(!await cpsiDriveReaderAuthorized(request,env))return json({ok:false,code:'DAILY_UNAUTHORIZED'},401);
  if(env.ENABLE_DAILY_ANALYSIS_V1!=='true'||env.ENABLE_DAILY_IMAGE_INTAKE_V1!=='true')return json({ok:false,code:'DAILY_RETRY_DISABLED'},503);
  const now=(options.clock||Date.now)(),date=u.searchParams.get('date');
  if(date!==jstDate(now)||u.searchParams.getAll('date').length!==1||[...u.searchParams.keys()].some(k=>k!=='date'))return json({ok:false,code:'DAILY_RETRY_TODAY_ONLY'},400);
  const id=retryPrefix(date)+crypto.randomUUID(),parent='DAILY_0900_JST:'+date;
  const claim=await env.DB.prepare(`INSERT INTO chass_daily_analysis_jobs (job_id,race_date,started_at,status,summary_json)
   SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM chass_daily_analysis_jobs WHERE job_id=? AND status IN ('HOLD','PARTIAL') AND completed_at IS NOT NULL)
   AND NOT EXISTS (SELECT 1 FROM chass_daily_analysis_jobs WHERE race_date=? AND status IN ('QUEUED','PROCESSING','RUNNING'))
   AND (SELECT COUNT(*) FROM chass_daily_analysis_jobs WHERE job_id GLOB ?)<8`).bind(id,date,new Date(now).toISOString(),'QUEUED',JSON.stringify({runMode:'RESEARCH_RETRY',parentJobId:parent,requestedAt:new Date(now).toISOString(),researchOnly:true,formalKpiEligible:false}),parent,date,retryPrefix(date)+'*').run();
  if(claim.meta?.changes!==1)return json({ok:false,code:'DAILY_RETRY_NOT_AVAILABLE'},409);
  return json({ok:true,date,jobId:id,status:'QUEUED',researchOnly:true,formalKpiEligible:false},202);
 }catch{return json({ok:false,code:'DAILY_RETRY_QUEUE_FAILED'},503);}
}
