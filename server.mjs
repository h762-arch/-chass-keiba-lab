import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VERSION="9.9.18";
const __dirname=path.dirname(fileURLToPath(import.meta.url));
const PUBLIC=process.env.CHASS_PUBLIC_DIR ? path.resolve(process.env.CHASS_PUBLIC_DIR) : __dirname;
const PORT=Number(process.env.PORT||3000);

const TRACK_NAMES={
  "3":"帯広","10":"盛岡","11":"水沢","18":"浦和","19":"船橋","20":"大井","21":"川崎",
  "22":"笠松","23":"金沢","24":"名古屋","27":"園田","28":"姫路","31":"高知","32":"佐賀","36":"門別"
};
const MIME={
  ".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",
  ".json":"application/json; charset=utf-8",".webmanifest":"application/manifest+json; charset=utf-8",
  ".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".svg":"image/svg+xml"
};
const cors={
  "access-control-allow-origin":"*",
  "access-control-allow-methods":"GET,OPTIONS",
  "access-control-allow-headers":"content-type,accept"
};

function sendJson(res,status,data){
  res.writeHead(status,{"content-type":"application/json; charset=utf-8","cache-control":"no-store",...cors});
  res.end(JSON.stringify(data,null,2));
}
function cleanText(html=""){
  return String(html).replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ")
    .replace(/<br\s*\/?>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;|&#160;/gi," ")
    .replace(/&amp;/gi,"&").replace(/\s+/g," ").trim();
}
function tableRows(html=""){
  return [...String(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(m=>{
    const cells=[...m[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(x=>cleanText(x[1]));
    return {cells,text:cells.join(" ")};
  });
}
async function fetchText(url){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);try{const r=await fetch(url,{headers:{
    "user-agent":`Mozilla/5.0 (compatible; ChassKeibaLab/${VERSION})`,
    "accept":"text/html,application/xhtml+xml","accept-language":"ja,en;q=0.8"
  },redirect:"follow",signal:controller.signal});
  if(!r.ok){const error=new Error(`NAR HTTP ${r.status}`);error.status=r.status;throw error}
  return await r.text()}finally{clearTimeout(timer)}
}

function parseRaceMeta(html){
  const text=cleanText(html);
  const dists=[...text.matchAll(/(?:ダート|芝|右|左|外|内)?\s*(\d{3,4})\s*m/gi)]
    .map(m=>Number(m[1])).filter(v=>v>=800&&v<=3600);
  const distance=dists.length?dists[0]:null;
  const weather=text.match(/天候[:：]?\s*(晴|曇|雨|雪)/)?.[1]||"";
  const trackCondition=text.match(/(?:馬場|馬場状態)[:：]?\s*(良|稍重|重|不良)/)?.[1]||"不明";
  let raceName="";
  const candidates=[
    ...[...String(html).matchAll(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi)].map(m=>cleanText(m[1])),
    ...[...String(html).matchAll(/<title[^>]*>([\s\S]*?)<\/title>/gi)].map(m=>cleanText(m[1]))
  ].filter(Boolean);
  raceName=candidates.find(x=>!/(地方競馬情報サイト|NAR|Keiba|競馬情報)/i.test(x)&&x.length>=2&&x.length<=100)||"";
  raceName=raceName.replace(/^\d{1,2}R\s*/,"").trim();
  return {raceName,distance,weather,trackCondition,surface:/芝\s*\d{3,4}\s*m/.test(text)?"芝":"ダート"};
}
function parseRaceCard(html){
  const out=[];
  for(const row of tableRows(html)){
    const c=row.cells;if(c.length<3)continue;
    let no=null,name="",start=0;
    if(/^\d{1,2}$/.test(String(c[1]||""))&&Number(c[1])>=1&&Number(c[1])<=18){no=String(Number(c[1]));name=String(c[2]||"");start=3;}
    else if(/^\d{1,2}$/.test(String(c[0]||""))&&Number(c[0])>=1&&Number(c[0])<=18){no=String(Number(c[0]));name=String(c[1]||"");start=2;}
    if(!no||!name||/馬番|馬名/.test(name))continue;
    let weight=null,sexAge="",jockey="",trainer="";
    for(let i=start;i<c.length;i++){
      const s=String(c[i]||"").trim();
      if(!sexAge&&/^[牡牝セ騙]\d+$/.test(s))sexAge=s;
      const wm=s.match(/^(\d{2}(?:\.\d)?)$/);if(weight==null&&wm){const v=Number(wm[1]);if(v>=45&&v<=65)weight=v;}
    }
    const texts=c.slice(start).filter(x=>x&&!/^\d+(?:\.\d+)?$/.test(String(x)));
    if(texts.length)jockey=String(texts[0]||"").trim();
    if(texts.length>1)trainer=String(texts[texts.length-1]||"").trim();
    out.push({horseNo:no,horseName:name.trim(),weight,sexAge,jockey,trainer});
  }
  const byNo=new Map();for(const x of out)if(!byNo.has(x.horseNo))byNo.set(x.horseNo,x);
  return [...byNo.values()].sort((a,b)=>Number(a.horseNo)-Number(b.horseNo));
}

function parseResult(html){
  const order=[],actualTimes={};
  for(const row of tableRows(html)){
    const c=row.cells;
    if(c.length<4)continue;
    const pos=String(c[0]||"").match(/^(\d{1,2})$/);
    if(!pos)continue;

    // NAR result tables normally contain 着順 / 枠番 / 馬番 near the left edge.
    // Prefer the second valid 1..18 number after position as horse number.
    const small=[];
    for(let i=1;i<Math.min(c.length,7);i++){
      const m=String(c[i]||"").match(/^(\d{1,2})$/);
      if(m&&Number(m[1])>=1&&Number(m[1])<=18)small.push(m[1]);
    }
    const horseNo=small.length>=2?small[1]:small[0];
    if(!horseNo)continue;

    const p=Number(pos[1]);
    if(p>=1&&p<=3)order[p-1]=horseNo;

    const tm=row.text.match(/\b(\d+):([0-5]\d(?:\.\d+)?)\b/);
    if(tm)actualTimes[horseNo]=tm[0];
  }
  return {finishOrder:order.filter(Boolean),actualTimes};
}
function parseTanFuku(html){
  const out=[];
  for(const row of tableRows(html)){
    const c=row.cells;
    if(c.length<4)continue;

    // Expected structure: 枠番 / 馬番 / 馬名 / 単勝 / 複勝...
    const frame=String(c[0]||"").match(/^(\d{1,2})$/)?.[1];
    const no=String(c[1]||"").match(/^(\d{1,2})$/)?.[1];
    if(!no||Number(no)<1||Number(no)>18)continue;

    const name=String(c[2]||"").trim();
    const m=String(c[3]||"").replace(/,/g,"").match(/(\d+(?:\.\d+)?)/);
    if(!m)continue;
    const odds=Number(m[1]);
    if(!Number.isFinite(odds)||odds<1||odds>=1000)continue;

    out.push({frameNo:frame?Number(frame):null,horseNo:String(Number(no)),horseName:name,odds});
  }
  const byNo=new Map();
  for(const x of out)if(!byNo.has(x.horseNo))byNo.set(x.horseNo,x);
  const result=[...byNo.values()];
  [...result].sort((a,b)=>a.odds-b.odds).forEach((x,i)=>x.popularity=i+1);
  return result;
}
function narUrls(code,date,race){
  const q=new URLSearchParams({k_babaCode:code,k_raceDate:String(date).replaceAll("-","/"),k_raceNo:race}).toString();
  return {
    result:`https://www.keiba.go.jp/KeibaWeb/TodayRaceInfo/RaceMarkTable?${q}`,
    odds:`https://www.keiba.go.jp/KeibaWeb/TodayRaceInfo/OddsTanFuku?${q}`
  };
}

async function apiRace(u,res){
  const code=u.searchParams.get("code"),date=u.searchParams.get("date"),race=u.searchParams.get("race");
  if(!code||!date||!race)return sendJson(res,400,{ok:false,error:"code,date,race are required"});
  const urls=narUrls(code,date,race);
  try{
    const [ch,oh]=await Promise.all([fetchText(urls.result),fetchText(urls.odds).catch(()=>"")]);
    const meta=parseRaceMeta(ch),cardHorses=parseRaceCard(ch),odds=parseTanFuku(oh);
    const cm=new Map(cardHorses.map(x=>[String(x.horseNo),x]));
    const om=new Map(odds.map(x=>[String(x.horseNo),x]));
    const numbers=[...new Set([...cardHorses.map(x=>String(x.horseNo)),...odds.map(x=>String(x.horseNo))])].sort((a,b)=>Number(a)-Number(b));
    const merged=numbers.map(no=>{
      const c=cm.get(no)||{},o=om.get(no)||{};
      const cardName=String(c.horseName||"").trim(),oddsName=String(o.horseName||"").trim();
      const cardBad=!cardName||/^\d{1,2}$/.test(cardName)||/^馬番\d+$/.test(cardName);
      return {...c,horseNo:no,horseName:(!cardBad?cardName:oddsName)||cardName||`馬番${no}`,odds:o.odds??null,popularity:o.popularity??null,nameSource:(!cardBad?"出馬表":oddsName?"オッズ表":"fallback")};
    });
    return sendJson(res,200,{ok:true,source:"NAR公式",version:VERSION,track:TRACK_NAMES[code]||"",code,date,race,...meta,horses:merged,odds,quality:{horseNames:merged.filter(x=>x.horseName&&!/^馬番/.test(x.horseName)).length,total:merged.length},acquiredAt:new Date().toISOString()});
  }catch(e){return sendJson(res,502,{ok:false,error:String(e?.message||e),source:"NAR公式",urls});}
}

async function apiOdds(u,res){
  const code=u.searchParams.get("code"),date=u.searchParams.get("date"),race=u.searchParams.get("race");
  if(!code||!date||!race)return sendJson(res,400,{ok:false,error:"code,date,race are required"});
  const urls=narUrls(code,date,race);
  try{
    const html=await fetchText(urls.odds);
    const odds=parseTanFuku(html);
    return sendJson(res,200,{ok:true,source:"NAR公式",version:VERSION,track:TRACK_NAMES[code]||"",code,date,race,odds,acquiredAt:new Date().toISOString()});
  }catch(e){
    return sendJson(res,502,{ok:false,error:String(e?.message||e),source:"NAR公式",urls});
  }
}
async function apiSync(u,res){
  const code=u.searchParams.get("code"),date=u.searchParams.get("date"),race=u.searchParams.get("race");
  if(!code||!date||!race)return sendJson(res,400,{ok:false,error:"code,date,race are required"});
  const urls=narUrls(code,date,race);
  try{
    const rh=await fetchText(urls.result);if(!rh)throw Object.assign(new Error('empty response'),{code:'empty_response'});const rr=parseResult(rh),finishOrder=(rr.finishOrder||[]).slice(0,3),resultSuccess=finishOrder.length>=3,optionalErrors=[];let odds=[];try{odds=parseTanFuku(await fetchText(urls.odds))}catch{optionalErrors.push('odds_fetch_failed')}
    return sendJson(res,200,{ok:true,status:resultSuccess?'success':'pending',stage:resultSuccess?'parse_complete':'result_rows_insufficient',resultSuccess,oddsSuccess:!optionalErrors.length,optionalErrors,primarySyncAudit:{success:resultSuccess,stage:resultSuccess?'parse_complete':'result_rows_insufficient',httpStatus:200,route:'RaceMarkTable',parsedRows:rr.results?.length||0,finishOrder},source:"NAR公式",version:VERSION,track:TRACK_NAMES[code]||"",code,date,race,...rr,finishOrder,odds,acquiredAt:new Date().toISOString(),pending:!resultSuccess,resultStatus:resultSuccess?'available':'result_unpublished'});
  }catch(e){const errorCode=e?.code||(e?.name==='AbortError'?'timeout':e?.status?'http_error':e instanceof TypeError?'network_error':'parse_error');return sendJson(res,e?.status===404?404:502,{ok:false,status:'failed',resultSuccess:false,stage:'result_fetch',errorCode,error:String(e?.message||e),source:"NAR公式"})}
}
async function staticFile(u,res){
  let pathname=decodeURIComponent(u.pathname);
  if(pathname==="/")pathname="/index.html";
  const normalized=path.normalize(pathname).replace(/^(\.\.(\/|\\|$))+/,"").replace(/^[/\\]+/,"");
  const file=path.resolve(PUBLIC,normalized);
  if(!file.startsWith(PUBLIC+path.sep)&&file!==PUBLIC){res.writeHead(403);return res.end("Forbidden");}
  try{
    const data=await fs.readFile(file);
    res.writeHead(200,{"content-type":MIME[path.extname(file)]||"application/octet-stream","cache-control":"no-cache"});
    res.end(data);
  }catch{
    res.writeHead(404,{"content-type":"text/plain; charset=utf-8"});
    res.end("Not Found");
  }
}

http.createServer(async(req,res)=>{
  if(req.method==="OPTIONS"){res.writeHead(204,cors);return res.end();}
  const u=new URL(req.url,`http://${req.headers.host||"localhost"}`);
  if(u.pathname==="/api/health")return sendJson(res,200,{ok:true,service:"chass-keiba-lab",version:VERSION});
  if(u.pathname==="/api/nar/race")return apiRace(u,res);
  if(u.pathname==="/api/nar/odds")return apiOdds(u,res);
  if(u.pathname==="/api/nar/sync"||u.pathname==="/api/nar/result-diagnostic")return apiSync(u,res);
  return staticFile(u,res);
}).listen(PORT,"0.0.0.0",()=>console.log(`CHASS KEIBA LAB Ver.${VERSION} :${PORT} / public=${PUBLIC}`));
