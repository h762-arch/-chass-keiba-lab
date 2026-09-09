import {validDate,JRA_TRACKS} from './jra-meeting-discovery.mjs';
import {resolveRaceCardUrl,parseJraRaceCard} from './jra-race-fetch.mjs';
export const JRA_ODDS_PARSER_VERSION='jra-official-win-odds-v1';
const TRACK_SET=new Set(JRA_TRACKS);
const LIST_URL='https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dli00/F3';
const strip=s=>String(s||'').replace(/<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
const number=s=>{const m=String(s||'').replace(/,/g,'').match(/\d+(?:\.\d+)?/),n=m?Number(m[0]):NaN;return Number.isFinite(n)?n:null};
const cellByClass=(cells,cls)=>cells.find(x=>new RegExp(`class=["'][^"']*\\b${cls}\\b`,'i').test(x.attr))?.html||'';
function oddsFromHorseCell(cell){
 const block=cell.match(/<div\b[^>]*class=["'][^"']*\bodds\b[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/i)?.[1]||'';
 const odds=number(block.match(/<span\b[^>]*class=["'][^"']*\bnum\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1]);
 const popularity=number(block.match(/<span\b[^>]*class=["'][^"']*\bpop_rank\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1]);
 return {odds,popularity};
}
export function parseJraWinOdds(html,expected={}){
 html=String(html||'');
 const card=parseJraRaceCard(html,expected),tables=[...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map(x=>x[1]);
 const table=tables.find(x=>/馬番/.test(strip(x))&&/単勝オッズ/.test(strip(x))&&/前走/.test(strip(x)));
 if(!table)throw Error('JRA_ODDS_PARSE_ERROR');
 const odds=[];
 for(const row of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
  const cells=[...row[1].matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi)].map(x=>({attr:x[1],html:x[2]}));
  const horseNo=number(cellByClass(cells,'num'));if(!horseNo)continue;
  const horseCell=cellByClass(cells,'horse'),{odds:winOdds,popularity}=oddsFromHorseCell(horseCell);
  const runner=card.horses.find(x=>x.horseNo===horseNo);if(runner?.runningStatus!=='active')continue;
  if(winOdds!=null&&winOdds>=1)odds.push({horseNo,odds:winOdds,popularity});
 }
 const active=card.horses.filter(x=>x.runningStatus==='active'),seen=new Set();
 if(odds.some(x=>seen.has(x.horseNo)||(seen.add(x.horseNo),false)))throw Error('JRA_ODDS_PARSE_ERROR');
 if(!odds.length){
  if(/発売前|未発売|オッズはまだ|投票受付前/.test(strip(html)))throw Error('JRA_ODDS_UNAVAILABLE');
  throw Error('JRA_ODDS_PARSE_ERROR');
 }
 const coverage=Number((odds.length/active.length).toFixed(4)),snapshotType=/オッズは最終オッズ/.test(strip(html))?'final':'live';
 return {organization:'JRA',date:card.race.date,track:card.race.racecourse,race:Number(card.race.raceNo),odds,quality:{activeHorseCount:active.length,oddsHorseCount:odds.length,oddsCoverage:coverage,complete:odds.length===active.length},oddsSnapshotType:snapshotType,source:'JRA_OFFICIAL',marketDataSource:'JRA_OFFICIAL_WIN_ODDS',parserVersion:JRA_ODDS_PARSER_VERSION};
}
async function readText(response,max=2097152){
 if(!response.ok)throw Error(response.status===404?'JRA_RACE_NOT_FOUND':'JRA_HTTP_ERROR');
 const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length>max)throw Error('JRA_ODDS_PARSE_ERROR');
 const hint=new TextDecoder().decode(bytes.slice(0,4096)),encoding=/shift[_-]?jis|sjis/i.test(response.headers.get('content-type')+' '+hint)?'shift-jis':'utf-8';return new TextDecoder(encoding).decode(bytes);
}
export function createJraOddsService({fetchImpl=globalThis.fetch,now=Date.now,timeoutMs=8000}={}){
 const cache=new Map(),pending=new Map();
 return async function handle(request,env={}){
  const u=new URL(request.url),date=u.searchParams.get('date')||'',track=u.searchParams.get('track')||'',race=Number(u.searchParams.get('race'));
  const send=(body,status=200,cacheState='BYPASS')=>new Response(request.method==='HEAD'?null:JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-CHASS-JRA-Odds-Cache':cacheState}});
  if(!['GET','HEAD'].includes(request.method))return send({ok:false,error:'METHOD_NOT_ALLOWED'},405);
  if(!validDate(date)||!TRACK_SET.has(track)||!Number.isInteger(race)||race<1||race>12)return send({ok:false,error:'JRA_RACE_INVALID_INPUT'},400);
  if(!(env.ENABLE_JRA_ODDS_FETCH===true||env.ENABLE_JRA_ODDS_FETCH==='true'))return send({ok:false,error:'JRA_ODDS_FETCH_DISABLED'},503);
  const key=`JRA:${date}:${track}:${race}`,saved=cache.get(key);if(saved?.expires>now())return send(saved.body,saved.status,'HIT');
  const joined=pending.has(key);if(!joined)pending.set(key,(async()=>{const controller=new AbortController();let timer;try{return await Promise.race([(async()=>{const list=await readText(await fetchImpl(LIST_URL,{signal:controller.signal,redirect:'error'}));const sourceUrl=resolveRaceCardUrl(list,{date,track,race});const html=await readText(await fetchImpl(sourceUrl,{signal:controller.signal,redirect:'error'}));const parsed=parseJraWinOdds(html,{date,track,race});return {body:{ok:true,...parsed,sourceUrl,acquiredAt:new Date(now()).toISOString()},status:200};})(),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('JRA_FETCH_TIMEOUT'));},timeoutMs)})]);}catch(error){const code=/^JRA_/.test(error.message)?error.message:'JRA_OFFICIAL_UNAVAILABLE';const status=code==='JRA_RACE_NOT_FOUND'?404:code==='JRA_ODDS_UNAVAILABLE'?409:503;return {body:{ok:false,organization:'JRA',date,track,race,error:code},status};}finally{clearTimeout(timer)}})());
  try{const result=await pending.get(key),ttl=result.body.ok?30000:15000;if(cache.size>=128)cache.delete(cache.keys().next().value);cache.set(key,{...result,expires:now()+ttl});return send(result.body,result.status,joined?'COALESCED':'MISS');}finally{pending.delete(key)}
 };
}
export const handleJraOddsRequest=createJraOddsService();
