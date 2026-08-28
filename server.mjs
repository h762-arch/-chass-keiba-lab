import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VERSION="9.1";
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
  const r=await fetch(url,{headers:{
    "user-agent":`Mozilla/5.0 (compatible; ChassKeibaLab/${VERSION})`,
    "accept":"text/html,application/xhtml+xml","accept-language":"ja,en;q=0.8"
  },redirect:"follow"});
  if(!r.ok)throw new Error(`NAR HTTP ${r.status}`);
  return r.text();
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
    const [rh,oh]=await Promise.all([fetchText(urls.result).catch(()=>""),fetchText(urls.odds).catch(()=>"")]);
    const rr=parseResult(rh),odds=parseTanFuku(oh);
    return sendJson(res,200,{
      ok:true,source:"NAR公式",version:VERSION,track:TRACK_NAMES[code]||"",code,date,race,
      ...rr,odds,acquiredAt:new Date().toISOString(),pending:rr.finishOrder.length<3
    });
  }catch(e){
    return sendJson(res,502,{ok:false,error:String(e?.message||e),source:"NAR公式",urls});
  }
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
  if(u.pathname==="/api/nar/odds")return apiOdds(u,res);
  if(u.pathname==="/api/nar/sync")return apiSync(u,res);
  return staticFile(u,res);
}).listen(PORT,"0.0.0.0",()=>console.log(`CHASS KEIBA LAB Ver.${VERSION} :${PORT} / public=${PUBLIC}`));
