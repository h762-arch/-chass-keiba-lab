/** Read-only, host-bound browser session. Never persist the reader token client-side. */
const NAME='__Host-chass_reader_v1',PATH='/api/chass/v1/reader-session',TTL=30*24*3600;
const validKey=k=>typeof k==='string'&&/^[-A-Za-z0-9_]{32,256}$/.test(k);
const utf8=s=>new TextEncoder().encode(s);
const hex=b=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
function allowed(request){const u=new URL(request.url),o=request.headers.get('origin'),site=request.headers.get('sec-fetch-site');return u.protocol==='https:'&&(!o||o===u.origin)&&(!site||['same-origin','none'].includes(site));}
async function signature(value,secret,origin){const key=await crypto.subtle.importKey('raw',utf8(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return hex(await crypto.subtle.sign('HMAC',key,utf8('CHASS_READER_SESSION_V1\n'+origin+'\n'+value)));}
const constantEqual=(a,b)=>{if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;};
export async function readerSessionValid(request,secret,now=Date.now()){
 if(!allowed(request)||!validKey(secret))return false;
 const parts=(request.headers.get('cookie')||'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(NAME+'='));
 if(parts.length!==1)return false;
 const value=parts[0].slice(NAME.length+1),m=value.match(/^v1\.(\d{10})\.(\d{10})\.([a-f0-9]{32})\.([a-f0-9]{64})$/);
 if(!m)return false;
 const issued=Number(m[1]),expires=Number(m[2]),seconds=Math.floor(now/1000);
 if(issued>seconds||expires<=seconds||expires-issued!==TTL)return false;
 const signed=value.slice(0,value.lastIndexOf('.'));
 return constantEqual(m[4],await signature(signed,secret,new URL(request.url).origin));
}
const cookie=(value,maxAge)=>`${NAME}=${value}; Path=/; Max-Age=${maxAge}; Secure; HttpOnly; SameSite=Strict`;
const response=(body,status=200,setCookie)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'private, no-store, max-age=0','vary':'Cookie, Authorization, Origin','x-content-type-options':'nosniff',...(setCookie?{'set-cookie':setCookie}:{})}});
export async function handleReaderSessionRequest(request,env={},options={}){
 const url=new URL(request.url);if(url.pathname!==PATH)return null;
 if(!allowed(request)||url.search)return response({ok:false,code:'READER_SESSION_ORIGIN_FORBIDDEN'},403);
 if(!['GET','POST','DELETE'].includes(request.method))return response({ok:false,code:'READER_SESSION_METHOD_NOT_ALLOWED'},405);
 // Writes require browser Origin, including logout, to prevent login/logout CSRF.
 if(request.method!=='GET'&&request.headers.get('origin')!==url.origin)return response({ok:false,code:'READER_SESSION_ORIGIN_FORBIDDEN'},403);
 if(request.method==='DELETE')return response({ok:true,connected:false},200,cookie('',0));
 const secret=env.CHASS_CPSI_DRIVE_READER_TOKEN;
 if(!validKey(secret))return response({ok:false,code:'READER_SESSION_NOT_CONFIGURED'},503);
 const now=options.now??Date.now();
 if(request.method==='GET')return response({ok:true,connected:await readerSessionValid(request,secret,now)});
 const auth=request.headers.get('authorization');
 if(!auth||auth.length>264||!auth.startsWith('Bearer '))return response({ok:false,code:'READER_SESSION_UNAUTHORIZED'},401);
 const [a,b]=await Promise.all([auth.slice(7),secret].map(x=>crypto.subtle.digest('SHA-256',utf8(x))));
 if(!constantEqual(hex(a),hex(b)))return response({ok:false,code:'READER_SESSION_UNAUTHORIZED'},401);
 const issued=Math.floor(now/1000),expires=issued+TTL,nonce=hex(crypto.getRandomValues(new Uint8Array(16))),value=`v1.${issued}.${expires}.${nonce}`;
 return response({ok:true,connected:true,expiresAt:new Date(expires*1000).toISOString()},200,cookie(value+'.'+await signature(value,secret,url.origin),TTL));
}
