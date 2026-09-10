export class ChassConnectorError extends Error{
 constructor(code,message,{status=null,cause=null,retryAfterSeconds=null}={}){super(message,{cause});this.name='ChassConnectorError';this.code=code;this.status=status;this.retryAfterSeconds=retryAfterSeconds}
}

const RETRYABLE_STATUS=new Set([502,503,504]);
const SAFE_PATHS=new Set(['/api/chass/v1/health','/api/chass/v1/context','/api/chass/v1/race','/api/chass/v1/research','/api/chass/v1/pending']);
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function connectorErrorFromResponse(status,payload){
 const upstream=String(payload?.error||''),message=String(payload?.message||'');
 if(status===401)return new ChassConnectorError('unauthorized','CHASS AI Data Bridgeの認証に失敗しました。',{status});
 if(status===404||upstream==='race_not_found')return new ChassConnectorError('race_not_found','指定されたレースはCHASS D1に保存されていません。',{status});
 if(status===429)return new ChassConnectorError('rate_limited','CHASS AI Data Bridgeの呼び出し上限に達しました。',{status,retryAfterSeconds:Number(payload?.retryAfterSeconds)||null});
 if(status===413||upstream==='response_too_large')return new ChassConnectorError('response_too_large','応答が大きすぎます。limitを小さくしてください。',{status});
 if(status===503&&/d1|database/i.test(`${upstream} ${message}`))return new ChassConnectorError('database_unavailable','CHASS D1を現在参照できません。',{status});
 if(status>=500)return new ChassConnectorError('bridge_unavailable','CHASS AI Data Bridgeを現在利用できません。',{status});
 return new ChassConnectorError('invalid_request',message||upstream||`CHASS Bridge HTTP ${status}`,{status});
}

export function bridgeConfig(env=process.env){
 const baseUrl=String(env.CHASS_API_BASE_URL||'').trim().replace(/\/+$/,''),token=String(env.CHASS_BRIDGE_TOKEN||'').trim(),timeoutMs=Math.max(1000,Math.min(10_000,Number(env.CHASS_HTTP_TIMEOUT_MS)||8000));
 if(!baseUrl||!/^https?:\/\//i.test(baseUrl))throw new ChassConnectorError('invalid_configuration','CHASS_API_BASE_URLが設定されていません。');
 if(!token)throw new ChassConnectorError('invalid_configuration','CHASS_BRIDGE_TOKENが設定されていません。');
 return {baseUrl,token,timeoutMs};
}

export async function requestBridge(path,{query={},env=process.env,fetchImpl=globalThis.fetch,sleep=wait,retries=1}={}){
 if(!SAFE_PATHS.has(path))throw new ChassConnectorError('invalid_request','許可されていないCHASS Bridge endpointです。');
 const {baseUrl,token,timeoutMs}=bridgeConfig(env),url=new URL(path,`${baseUrl}/`);
 for(const [key,value] of Object.entries(query||{}))if(value!==undefined&&value!==null&&value!=='')url.searchParams.set(key,String(value));
 let lastError;
 for(let attempt=0;attempt<=Math.max(0,Math.min(1,retries));attempt++){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort('timeout'),timeoutMs);
  try{
   const response=await fetchImpl(url,{method:'GET',headers:{accept:'application/json','accept-charset':'utf-8',authorization:`Bearer ${token}`},signal:controller.signal,redirect:'error'}),text=await response.text();
   let payload={};try{payload=text?JSON.parse(text):{}}catch{throw new ChassConnectorError('bridge_unavailable','CHASS BridgeからJSON以外の応答を受信しました。',{status:response.status})}
   if(!response.ok){const error=connectorErrorFromResponse(response.status,payload);if(attempt<retries&&RETRYABLE_STATUS.has(response.status)){lastError=error;await sleep(300);continue}throw error}
   return payload;
  }catch(error){
   const timeout=controller.signal.aborted||error?.name==='AbortError',normalized=error instanceof ChassConnectorError?error:new ChassConnectorError(timeout?'timeout':'bridge_unavailable',timeout?'CHASS AI Data Bridgeへの接続がタイムアウトしました。':'CHASS AI Data Bridgeへ接続できません。',{cause:error});
   if(attempt<retries&&['timeout','bridge_unavailable'].includes(normalized.code)){lastError=normalized;await sleep(300);continue}throw normalized;
  }finally{clearTimeout(timer)}
 }
 throw lastError||new ChassConnectorError('bridge_unavailable','CHASS AI Data Bridgeへ接続できません。');
}

