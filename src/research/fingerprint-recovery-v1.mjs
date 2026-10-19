import {inspectRecordBinding} from './original-record-reader-v1.mjs';

export const FINGERPRINT_RECOVERY_MAX_BYTES=262144;
const columns=['race_fp','prediction_fp','market_fp','final_fp','result_fp','validation_fp','live_fp'];
const bodies=['race_json','prediction_json','market_json','final_json','result_json','validation_json'];
const keys=['raceFingerprint','predictionFingerprint','marketFingerprint','finalFingerprint','resultFingerprint','validationFingerprint','liveFingerprint'];
const error=code=>Object.assign(new Error(code),{code});
const present=v=>typeof v==='string'&&v.length>0;
function descriptor(row,values){return {raceId:row.race_id,modelVersion:row.model_version,status:row.status,updatedAt:row.updated_at,fingerprintStatus:'stored',...Object.fromEntries(keys.map((k,i)=>[k,values[i]]))};}

export async function recoverFingerprintMetadata(DB,raceId,modelVersion,{fingerprint}={}){
 if(typeof raceId!=='string'||!/^\d{4}-\d{2}-\d{2}\|[^|\u0000-\u001f]{1,80}\|[1-9]\d?$/.test(raceId)||typeof modelVersion!=='string'||!modelVersion.trim()||modelVersion.length>128||/[\u0000-\u001f]/.test(modelVersion))throw error('fingerprint_invalid_identity');
 if(!DB)throw error('d1_binding_unavailable');
 if(typeof fingerprint!=='function')throw error('fingerprint_implementation_unavailable');
 let row;try{row=await DB.prepare(`SELECT race_id,model_version,status,updated_at,race_json,prediction_json,market_json,final_json,result_json,validation_json,race_fp,prediction_fp,market_fp,final_fp,result_fp,validation_fp,live_fp FROM races WHERE race_id=? AND model_version=? LIMIT 1`).bind(raceId,modelVersion).first();}
 catch(e){throw error(/no such column/i.test(String(e?.message||''))?'d1_schema_error':'d1_read_failed');}
 if(!row)throw error('fingerprint_record_not_found');
 if(row.race_id!==raceId||row.model_version!==modelVersion)throw error('fingerprint_response_invalid');
 const base={raceId,modelVersion};
 const stored=columns.map(k=>row[k]);
 if([0,1,6].every(i=>present(stored[i]))&&stored.every(v=>v===null||present(v)))return {...base,outcome:'already_present',metadataWritten:false,descriptor:descriptor(row,stored)};
 if(bodies.reduce((n,k)=>n+new TextEncoder().encode(row[k]||'').length,0)>FINGERPRINT_RECOVERY_MAX_BYTES)return {...base,outcome:'skipped',reason:'record_too_large',metadataWritten:false};
 let values;try{values=bodies.map(k=>row[k]==null?null:JSON.parse(row[k]));}catch{return {...base,outcome:'skipped',reason:'invalid_json',metadataWritten:false};}
 const [race,prediction,market,final,result,validation]=values;
 if(!race||typeof race!=='object'||Array.isArray(race)||!prediction?.horses?.length||!present(row.status))return {...base,outcome:'skipped',reason:'incomplete_record',metadataWritten:false};
 const record={race,modelVersion,predictionSnapshot:prediction,marketSnapshot:market,finalSnapshot:final,resultSnapshot:result,validationSnapshot:validation};
 if(inspectRecordBinding(record,raceId).status==='HOLD')return {...base,outcome:'skipped',reason:'binding_conflict',metadataWritten:false};
 const computed=[...values.map(fingerprint),fingerprint({liveAdjustedPrediction:race.liveAdjustedPrediction||null,scratchAudit:race.scratchAudit||null})];
 if(stored.some((v,i)=>present(v)&&v!==computed[i]))return {...base,outcome:'skipped',reason:'existing_fingerprint_conflict',metadataWritten:false};
 const assignments=columns.map(k=>`${k}=CASE WHEN ${k} IS NULL OR ${k}='' THEN ? ELSE ${k} END`).join(',');
 const guards=[...bodies,'status','updated_at',...columns];
 let saved;try{saved=await DB.prepare(`UPDATE races SET ${assignments} WHERE race_id=? AND model_version=? AND ${guards.map(k=>`${k} IS ?`).join(' AND ')}`).bind(...computed,raceId,modelVersion,...guards.map(k=>row[k]??null)).run();}catch{throw error('d1_fingerprint_write_failed');}
 if(saved?.meta?.changes!==1)return {...base,outcome:'concurrent_change',metadataWritten:false};
 return {...base,outcome:'recovered',metadataWritten:true,descriptor:descriptor(row,computed)};
}
