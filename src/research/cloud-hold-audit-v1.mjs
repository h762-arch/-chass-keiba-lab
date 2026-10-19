const fail=code=>Object.assign(new Error(code),{code});
export async function readD1HoldAudit(DB,raceId,modelVersion){
 if(typeof raceId!=='string'||!/^\d{4}-\d{2}-\d{2}\|[^|\u0000-\u001f]{1,80}\|[1-9]\d?$/.test(raceId)||typeof modelVersion!=='string'||!modelVersion.trim()||modelVersion.length>128||/[\u0000-\u001f]/.test(modelVersion))throw fail('audit_invalid_identity');
 if(!DB)throw fail('d1_binding_unavailable');
 let row;try{row=await DB.prepare(`SELECT race_id,model_version,status,updated_at,race_json,prediction_json,market_json,final_json,result_json,validation_json FROM races WHERE race_id=? AND model_version=? LIMIT 1`).bind(raceId,modelVersion).first();}catch{throw fail('d1_read_failed');}
 if(!row)throw fail('audit_record_not_found');
 if(row.race_id!==raceId||row.model_version!==modelVersion)throw fail('audit_record_invalid');
 const fields=['race_json','prediction_json','market_json','final_json','result_json','validation_json'];
 if(fields.reduce((n,k)=>n+new TextEncoder().encode(row[k]||'').length,0)>262144)throw fail('audit_record_too_large');
 let parts;try{parts=fields.map(k=>row[k]==null?null:JSON.parse(row[k]));}catch{throw fail('audit_record_invalid');}
 const [race,prediction,market,final,result,validation]=parts;
 if(!race||typeof race!=='object'||Array.isArray(race)||!prediction||typeof prediction!=='object'||Array.isArray(prediction)||typeof row.status!=='string')throw fail('audit_record_invalid');
 const embedded={};for(const k of ['resultQueue','liveAdjustedPrediction','scratchAudit','snapshotIntegrity']){embedded[k]=race[k]??null;delete race[k];}
 return {raceId,modelVersion,status:row.status,updatedAt:row.updated_at,record:{race,...embedded,modelVersion,predictionSnapshot:prediction,marketSnapshot:market,finalSnapshot:final,resultSnapshot:result,validationSnapshot:validation,validated:row.status==='validated',validationCompleted:row.status==='validated'}};
}
