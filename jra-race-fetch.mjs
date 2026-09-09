import {JRA_TRACKS,validDate} from './jra-meeting-discovery.mjs';
export const JRA_RACE_PARSER_VERSION='jra-official-card-v1';
const TRACK_CODES={札幌:'01',函館:'02',福島:'03',新潟:'04',東京:'05',中山:'06',中京:'07',京都:'08',阪神:'09',小倉:'10'};
const LIST_URL='https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dli00/F3';
const strip=s=>String(s||'').replace(/<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
const pick=(html,cls)=>{const m=html.match(new RegExp(`<([a-z][a-z0-9]*)[^>]+class=["'][^"']*\\b${cls}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`,'i'));return m?.[2]||''};
const altNumber=html=>number(String(html||'').match(/alt=["'][^"']*?(\d+)(?:レース|白|黒|赤|青|黄|緑|橙|桃)[^"']*["']/i)?.[1]);
const number=s=>{const n=Number(String(s||'').replace(/,/g,'').match(/[+-]?\d+(?:\.\d+)?/)?.[0]);return Number.isFinite(n)?n:null};
const jpDate=s=>{const m=strip(s).match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);return m?`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`:''};
function classBlock(html,tag,cls){return [...html.matchAll(new RegExp(`<${tag}\\b[^>]*class=["'][^"']*\\b${cls}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/${tag}>`,'gi'))].map(x=>x[1]);}
export function resolveRaceCardUrl(listHtml,{date,track,race}){
  if(!validDate(date)||!TRACK_CODES[track]||!Number.isInteger(race)||race<1||race>12)throw Error('JRA_RACE_INVALID_INPUT');
  const compact=date.replaceAll('-',''),year=date.slice(0,4),code=TRACK_CODES[track],rr=String(race).padStart(2,'0');
  const hrefs=[...String(listHtml).matchAll(/(?:href|onclick)=["']([^"']*(?:accessD\.html|pw01dde)[^"']*)["']/gi)].map(x=>x[1].replaceAll('&amp;','&'));
  const token=new RegExp(`pw01dde\\d{2}${code}${year}\\d{4}${rr}${compact}\\/[0-9A-F]{2}`,'i');
  const found=hrefs.map(x=>x.match(token)?.[0]).find(Boolean);if(!found)throw Error('JRA_RACE_NOT_FOUND');
  return `https://www.jra.go.jp/JRADB/accessD.html?CNAME=${found}`;
}
function parsePast(cell){
  if(!strip(cell))return null;
  const distanceText=strip(pick(cell,'dist')),surface=/芝/.test(distanceText)?'芝':/ダ/.test(distanceText)?'ダート':'';
  const place=strip(pick(cell,'place')),finish=number(place),max=number(pick(cell,'max')),time=strip(pick(cell,'time'));
  return {date:jpDate(pick(cell,'date')),racecourse:strip(pick(cell,'rc')),raceName:strip(pick(cell,'name')),raceClass:strip(pick(cell,'r_class')),finish:/着/.test(place)?finish:null,fieldSize:max,jockey:strip(pick(cell,'jockey')),weightCarried:number(pick(cell,'weight')),distance:number(distanceText),surface,time:/^\d+:\d{2}\.\d$/.test(time)?time:'',trackCondition:strip(pick(cell,'condition'))||'不明',bodyWeight:number(pick(cell,'h_weight')),cornerPositions:strip(pick(cell,'corner_list')).split(/[-→\s]+/).map(Number).filter(Number.isFinite),last3F:number(pick(cell,'f3')),historicalStatus:/除外/.test(place)?'excluded':/取消/.test(place)?'scratched':/中止/.test(place)?'dnf':'finished'};
}
export function parseJraRaceCard(html,expected={}){
  html=String(html||'');if(!/<\/html\s*>/i.test(html)||/このレースの出馬表の掲載は終了/.test(strip(html)))throw Error('JRA_PARSER_STRUCTURE_CHANGED');
  const header=html.match(/<div\b[^>]*class=["'][^"']*\brace_header\b[^"']*["'][^>]*>([\s\S]*?)<table\b/i)?.[1]||html;
  const dateText=strip(pick(header,'date')),date=jpDate(dateText),track=JRA_TRACKS.find(x=>dateText.includes(x))||'',raceNo=number(strip(pick(header,'race_number')))||altNumber(pick(header,'race_number')),course=strip(pick(header,'course')),raceName=strip(pick(header,'race_name'));
  const surface=/ダ/.test(course)?'ダート':/芝/.test(course)?'芝':'',distance=number(course),direction=/左/.test(course)?'左':/右/.test(course)?'右':'',courseType=/外/.test(course)?'外回り':/内/.test(course)?'内回り':'';
  if(!date||!track||!raceNo||!surface||!distance||!raceName)throw Error('JRA_PARSER_INCOMPLETE');
  if((expected.date&&date!==expected.date)||(expected.track&&track!==expected.track)||(expected.race&&raceNo!==Number(expected.race)))throw Error('JRA_RACE_MISMATCH');
  const tables=[...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map(x=>x[1]);const table=tables.find(x=>/前走/.test(strip(x))&&/馬番/.test(strip(x)));if(!table)throw Error('JRA_PARSER_STRUCTURE_CHANGED');
  const tbody=table.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i)?.[1];if(!tbody)throw Error('JRA_PARSER_STRUCTURE_CHANGED');
  const horses=[];
  for(const row of tbody.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi)){
    const cells=[...row[2].matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi)].map(x=>({attr:x[1],html:x[2]}));
    const by=cls=>cells.find(x=>new RegExp(`class=["'][^"']*\\b${cls}\\b`,'i').test(x.attr))?.html||'';
    const no=number(by('num'));if(!no)continue;const horseCell=by('horse'),jockeyCell=by('jockey');
    const horseName=strip(pick(horseCell,'name')),frameNo=number(strip(by('waku')))||altNumber(by('waku')),sexAge=strip(pick(jockeyCell,'age')),weightCarried=number(pick(jockeyCell,'weight')),jockey=strip(pick(jockeyCell,'jockey')).replace(/^[△▲☆]/,'').trim(),trainer=strip(pick(horseCell,'trainer')).replace(/\((美浦|栗東)\)$/,'').trim();
    const weightText=strip(pick(horseCell,'weight')),bodyWeight=number(weightText),transition=strip(pick(horseCell,'transition')),bodyWeightChange=/初出走/.test(transition)?null:number(transition);
    const currentText=strip(row[2].replace(/<td\b[^>]*class=["'][^"']*\bpast\b[^"']*["'][^>]*>[\s\S]*?<\/td>/gi,''));
    const runningStatus=/出走取消|取消/.test(currentText)?'scratched':/競走除外|除外/.test(currentText)?'excluded':'active';
    const pastRuns=cells.filter(x=>/class=["'][^"']*\bpast\b/i.test(x.attr)).map(x=>parsePast(x.html)).filter(Boolean);
    horses.push({horseNo:no,frameNo,horseName,sexAge,weightCarried,jockey,trainer,bodyWeight,bodyWeightChange,runningStatus,pastRuns,odds:null,popularity:null});
  }
  const seen=new Set(),active=horses.filter(x=>x.runningStatus==='active');
  if(horses.length<2||horses.some(h=>!h.horseName||!h.weightCarried||!h.jockey||seen.has(h.horseNo)||(seen.add(h.horseNo),false)))throw Error('JRA_PARSER_INCOMPLETE');
  if(active.length<2)throw Error('JRA_PARSER_INCOMPLETE');
  const rate=key=>horses.filter(x=>x[key]!=null&&x[key]!=='').length/horses.length;
  const quality={raceParsed:true,horseCount:horses.length,activeHorseCount:active.length,horseNameRate:rate('horseName'),weightRate:rate('weightCarried'),jockeyRate:rate('jockey'),pastRunRate:horses.filter(x=>x.pastRuns.length).length/horses.length};
  return {race:{date,racecourse:track,raceNo,raceName,surface,distance,direction,courseType,raceClass:strip(pick(header,'class')),trackCondition:'不明',weather:'',pace:'標準'},horses,quality,source:'JRA_OFFICIAL',parserVersion:JRA_RACE_PARSER_VERSION,dataConfidence:quality.horseNameRate===1&&quality.weightRate===1&&quality.jockeyRate===1?'high':'low'};
}
async function readText(response,max=2097152){if(!response.ok)throw Error(response.status===404?'JRA_RACE_NOT_FOUND':'JRA_HTTP_ERROR');const reader=response.body.getReader(),parts=[];let size=0;while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){reader.cancel();throw Error('JRA_PARSER_STRUCTURE_CHANGED');}parts.push(value);}const bytes=new Uint8Array(size);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length;}const hint=new TextDecoder().decode(bytes.slice(0,4096));return new TextDecoder(/shift[_-]?jis|sjis/i.test(response.headers.get('content-type')+' '+hint)?'shift-jis':'utf-8').decode(bytes);}
export function createJraRaceService({fetchImpl=globalThis.fetch,now=Date.now,timeoutMs=10000}={}){
  const cache=new Map(),pending=new Map();
  return async function handle(request,env={}){
    const u=new URL(request.url),date=u.searchParams.get('date')||'',track=u.searchParams.get('track')||'',race=Number(u.searchParams.get('race'));
    const send=(body,status=200,cacheState='BYPASS')=>new Response(request.method==='HEAD'?null:JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-CHASS-JRA-Race-Cache':cacheState}});
    if(!['GET','HEAD'].includes(request.method))return send({ok:false,error:'METHOD_NOT_ALLOWED'},405);
    if(!validDate(date)||!TRACK_CODES[track]||!Number.isInteger(race)||race<1||race>12)return send({ok:false,error:'JRA_RACE_INVALID_INPUT'},400);
    const key=`JRA:${date}:${track}:${race}`,saved=cache.get(key);if(saved?.expires>now())return send(saved.body,saved.status,'HIT');
    const joined=pending.has(key);if(!joined)pending.set(key,(async()=>{const controller=new AbortController();let timer;try{const result=await Promise.race([(async()=>{const list=await readText(await fetchImpl(LIST_URL,{signal:controller.signal,redirect:'error'}));const sourceUrl=resolveRaceCardUrl(list,{date,track,race});const html=await readText(await fetchImpl(sourceUrl,{signal:controller.signal,redirect:'error'}));const parsed=parseJraRaceCard(html,{date,track,race});return {body:{ok:true,organization:'JRA',...parsed,sourceUrl,fetchedAt:new Date(now()).toISOString(),autoFetchEnabled:env.ENABLE_JRA_AUTO_FETCH===true||env.ENABLE_JRA_AUTO_FETCH==='true'},status:200};})(),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('JRA_FETCH_TIMEOUT'));},timeoutMs);})]);return result;}catch(error){const code=/^JRA_/.test(error.message)?error.message:'JRA_OFFICIAL_UNAVAILABLE';return {body:{ok:false,organization:'JRA',date,track,race,status:'unknown',error:code},status:code==='JRA_RACE_NOT_FOUND'?404:503};}finally{clearTimeout(timer);}})());
    try{const result=await pending.get(key),ttl=result.body.ok?(date<new Date(now()).toISOString().slice(0,10)?86400000:300000):60000;if(cache.size>=128)cache.delete(cache.keys().next().value);cache.set(key,{...result,expires:now()+ttl});return send(result.body,result.status,joined?'COALESCED':'MISS');}finally{pending.delete(key);}
  };
}
export const handleJraRaceRequest=createJraRaceService();
