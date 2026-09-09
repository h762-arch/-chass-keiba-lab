// J1: planned meetings only. Never fetch runners, odds or results here.
export const JRA_TRACKS = ['札幌','函館','福島','新潟','東京','中山','中京','京都','阪神','小倉'];
export const PARSER_VERSION = 'jra-program-v1';
export const FEATURE_DEFAULTS = Object.freeze({ENABLE_JRA_MEETING_DISCOVERY:true,ENABLE_JRA_AUTO_FETCH:false,ENABLE_JRA_ODDS_FETCH:false,ENABLE_JRA_RESULT_FETCH:false});
const clean = s => s.replace(/<[^>]*>/g,'').replace(/&nbsp;|&#160;/g,' ').replace(/\s/g,'');
export function validDate(date){return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0,10)===date;}
export function sourceUrl(date){if(!validDate(date))throw Error('JRA_INVALID_DATE');const [y,m,d]=date.split('-');return `https://www.jra.go.jp/keiba/calendar${y}/${y}/${Number(m)}/${m}${d}.html`;}
export function parseJraProgram(html,date){
  const fail=()=>{throw Error('JRA_PARSER_STRUCTURE_CHANGED');};
  if(!validDate(date)||!/<\/html\s*>/i.test(html))return fail();
  html=html.replace(/<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>/gi,'');
  const [y,m,d]=date.split('-').map(Number);
  const headings=[...html.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi)].map(x=>clean(x[1]));
  if(!headings.some(x=>x.includes(`${y}年${m}月${d}日`)&&x.includes('競馬番組')))return fail();
  if((html.match(/<table\b/gi)||[]).length!==(html.match(/<\/table>/gi)||[]).length)return fail();
  const found=new Map();
  for(const match of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)){
    const table=match[1],caption=clean(table.match(/<caption\b[^>]*>([\s\S]*?)<\/caption>/i)?.[1]||'');
    if(!/\d+回.+\d+日/.test(caption)){if(clean(table).includes('レース番号'))return fail();continue;}
    const track=JRA_TRACKS.find(t=>caption.includes(t));
    if(!track||found.has(track)||!clean(table).includes('レース番号'))return fail();
    const body=table.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i)?.[1];if(!body)return fail();
    const numbers=[];
    for(const row of body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
      const cell=row[1].match(/<th\b[^>]*scope=["']row["'][^>]*>([\s\S]*?)<\/th>/i);
      const num=Number(clean(cell?.[1]||'').match(/^(\d{1,2})レース$/)?.[1]);
      if(!num||num>12||numbers.includes(num))return fail();numbers.push(num);
    }
    if(!numbers.length)return fail();found.set(track,numbers);
  }
  if(!found.size)return fail();
  return JRA_TRACKS.map(track=>({organization:'JRA',date,track,status:found.has(track)?'meeting':'non_meeting',raceNumbers:found.get(track)||[]}));
}
export function createJraMeetingService({fetchImpl=globalThis.fetch,now=Date.now,timeoutMs=8000}={}){
  const cache=new Map(),pending=new Map();let structureFailures=0,pauseUntil=0;
  return async function handle(request,env={}){
    const url=new URL(request.url),date=url.searchParams.get('date')||'';
    const respond=(body,status=200,hit='BYPASS')=>new Response(request.method==='HEAD'?null:JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-CHASS-Meeting-Cache':hit}});
    if(!['GET','HEAD'].includes(request.method))return respond({ok:false,error:'METHOD_NOT_ALLOWED'},405);
    if(!validDate(date))return respond({ok:false,error:'JRA_INVALID_DATE'},400);
    const base={organization:'JRA',date,source:'JRA_OFFICIAL',sourceUrl:sourceUrl(date),parserVersion:PARSER_VERSION,scheduleOnly:true};
    const unknown=error=>({...base,ok:false,status:'unknown',error,meetings:JRA_TRACKS.map(track=>({organization:'JRA',date,track,status:'unknown',raceNumbers:[]}))});
    if(env.ENABLE_JRA_MEETING_DISCOVERY===false||env.ENABLE_JRA_MEETING_DISCOVERY==='false')return respond(unknown('JRA_MEETING_DISCOVERY_DISABLED'));
    const key=`JRA:${date}`,saved=cache.get(key);
    if(saved&&saved.expires>now())return respond(saved.body,saved.status,'HIT');
    if(now()<pauseUntil)return respond(unknown('JRA_AUTO_FETCH_PAUSED'),503);
    const joined=pending.has(key);
    if(!joined){
      if(pending.size>=4)return respond(unknown('JRA_OFFICIAL_BUSY'),503);
      pending.set(key,(async()=>{
        let timer,body,status=200;
        const controller=new AbortController();
        try{
          const html=await Promise.race([(async()=>{
            const response=await fetchImpl(base.sourceUrl,{signal:controller.signal,redirect:'error'});
            if(!response.ok)throw Error(response.status===404?'JRA_MEETING_NOT_FOUND':'JRA_HTTP_ERROR');
            const reader=response.body.getReader();let size=0;const chunks=[];
            while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>524288){await reader.cancel();throw Error('JRA_PARSER_STRUCTURE_CHANGED');}chunks.push(value);}
            const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
            const hint=new TextDecoder().decode(bytes.slice(0,4096));
            const encoding=/shift[_-]?jis|sjis/i.test(response.headers.get('content-type')+' '+hint)?'shift-jis':'utf-8';
            return new TextDecoder(encoding).decode(bytes);
          })(),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('JRA_FETCH_TIMEOUT'));},timeoutMs);})]);
          body={...base,ok:true,status:'meeting',meetings:parseJraProgram(html,date)};
          structureFailures=0;
        }catch(error){status=503;body=unknown(/^JRA_/.test(error.message)?error.message:'JRA_OFFICIAL_UNAVAILABLE');}
        finally{clearTimeout(timer);}
        if(body.error==='JRA_PARSER_STRUCTURE_CHANGED'&&++structureFailures>=3){pauseUntil=now()+300000;structureFailures=0;}
        const ttl=body.ok?(date<new Date(now()).toISOString().slice(0,10)?86400000:1200000):60000;
        body.checkedAt=new Date(now()).toISOString();body.cacheTtlSeconds=ttl/1000;
        if(cache.size>=128)cache.delete(cache.keys().next().value);
        cache.set(key,{body,status,expires:now()+ttl});return {body,status};
      })());
    }
    try{const result=await pending.get(key);return respond(result.body,result.status,joined?'COALESCED':'MISS');}
    finally{pending.delete(key);}
  };
}
export const handleJraMeetingRequest=createJraMeetingService();
