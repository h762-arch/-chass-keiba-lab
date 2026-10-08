import {captureNarInitialResearchBundle,readNarInitialResearchBundle} from './nar-initial-research-bundle.mjs';
import {createNarInitialSqlStore} from './nar-initial-sql-store.mjs';
import {observeNarSqlCommitResearch,saveNarCommitObservationResearch,readNarInitialAdmissionResearch} from './nar-commit-admission.mjs';

const queues=new WeakMap();
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v)}return v};
const finish=(status,reason,details={})=>freeze({status,reason,...details,researchOnly:true,formalKpiEligible:false,adopted:false});
async function serial(db,work){const prior=queues.get(db)||Promise.resolve();let release;const next=new Promise(r=>release=r);queues.set(db,next);await prior;try{return await work()}finally{release();if(queues.get(db)===next)queues.delete(db)}}
const insertSql='INSERT INTO research_nar_initial_bundles (storage_key,snapshot_json) VALUES (?,?)';

// Explicit local research orchestration only. Schema setup stays external.
// One dedicated db connection; unrelated transactions must not use it.
export async function runNarInitialShadowSession({enabled=false,db,receiptStore,raceId,acquire,clock=Date.now}={}){
 if(enabled!==true)return finish('DISABLED',null);
 if(!db||!['exec','first','run'].every(k=>typeof db[k]==='function')||typeof clock!=='function')return finish('REJECTED','SESSION_CONTRACT_INVALID');
 return serial(db,async()=>{
  try{
   const plain=createNarInitialSqlStore({db,mode:'read-only',clock});
   const existing=await readNarInitialAdmissionResearch({store:plain,receiptStore,raceId});
   if(existing.status!=='MISSING')return finish(existing.status,existing.reason,{captureStatus:'NOT_RUN',auditStatus:'NOT_RUN',admission:existing});
   if(typeof acquire!=='function'||typeof receiptStore?.get!=='function'||typeof receiptStore.insertIfAbsent!=='function')return finish('REJECTED','SESSION_WRITE_CONTRACT_INVALID');
   let pending=null;const targets=[];
   const bound={
    first:(...args)=>db.first(...args),
    async run(sql,args){
     const result=await db.run(sql,args);
     if(sql===insertSql&&result?.changes===1&&Array.isArray(args)&&args.length===2&&args[0]==='nar-initial-research:v1:'+raceId&&typeof args[1]==='string'){
      // Preserve exact inserted bytes rather than attaching an event to whichever
      // row happens to be read later. Invalid JSON cannot create trusted evidence.
      pending={key:args[0],json:args[1]};
     }
     return result;
    },
    async exec(sql){
     if(sql==='BEGIN IMMEDIATE')pending=null;
     if(sql==='COMMIT')targets.push(pending===null?null:{...pending});
     const result=await db.exec(sql);
     if(sql==='ROLLBACK'||sql==='COMMIT')pending=null;
     return result;
    },
   };
   const observer=observeNarSqlCommitResearch({db:bound,clock});
   const store=createNarInitialSqlStore({db:observer.db,mode:'research-write',clock});
   const captured=await captureNarInitialResearchBundle({enabled:true,store,raceId,acquire,clock});
   const events=observer.observations();let auditStatus='NOT_RUN';
   if(events.length===1&&targets.length===1&&targets[0]!==null){
    const source=await readNarInitialResearchBundle({store:plain,raceId});
    if(source.status==='PRESERVED'&&source.kind==='INITIAL_RESEARCH'){
     const raw=await plain.get(targets[0].key);
     if(raw===targets[0].json){
      const audit=await saveNarCommitObservationResearch({enabled:true,snapshot:source.snapshot,observation:events[0],receiptStore});
      auditStatus=audit.status;
     }else auditStatus='TARGET_MISMATCH';
    }else auditStatus='SOURCE_UNCONFIRMED';
   }else if(events.length!==0||targets.length!==0)auditStatus='ATTEMPT_UNCONFIRMED';
   // Even capture failure can leave committed bytes. Admission independently
   // verifies that row and its evidence; no deletion, repair or new acquisition.
   const admission=await readNarInitialAdmissionResearch({store:plain,receiptStore,raceId});
   if(admission.status==='MISSING'&&captured.status==='REJECTED')return finish('REJECTED',captured.reason,{captureStatus:captured.status,auditStatus,commitObservationCount:events.length,admission});
   return finish(admission.status,admission.reason,{captureStatus:captured.status,auditStatus,commitObservationCount:events.length,admission});
  }catch{return finish('REJECTED','SESSION_FAILED')}
 });
}
