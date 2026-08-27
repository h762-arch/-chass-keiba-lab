import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, "public");
const PORT = Number(process.env.PORT || 3000);

const TRACK_NAMES = { "19":"船橋", "22":"笠松", "27":"園田", "28":"姫路", "36":"門別" };
const MIME = {
  ".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8",
  ".css":"text/css; charset=utf-8", ".json":"application/json; charset=utf-8",
  ".webmanifest":"application/manifest+json; charset=utf-8",
  ".png":"image/png", ".jpg":"image/jpeg", ".jpeg":"image/jpeg", ".svg":"image/svg+xml"
};
const cors = {
  "access-control-allow-origin":"*",
  "access-control-allow-methods":"GET,OPTIONS",
  "access-control-allow-headers":"content-type,accept"
};
function sendJson(res,status,data){
  res.writeHead(status,{"content-type":"application/json; charset=utf-8","cache-control":"no-store",...cors});
  res.end(JSON.stringify(data));
}
function cleanText(html){
  return html.replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ")
    .replace(/<[^>]+>/g," ").replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&")
    .replace(/\s+/g," ").trim();
}
async function fetchText(url){
  const r=await fetch(url,{headers:{
    "user-agent":"Mozilla/5.0 (compatible; ChassKeibaLab/7.1)",
    "accept":"text/html,application/xhtml+xml",
    "accept-language":"ja,en;q=0.8"
  },redirect:"follow"});
  if(!r.ok) throw new Error(`NAR HTTP ${r.status}`);
  return r.text();
}
function parseFinishOrder(html){
  const text=cleanText(html);
  let m=text.match(/三連単\s*([0-9]+)\s*[-－]\s*([0-9]+)\s*[-－]\s*([0-9]+)/);
  if(m) return [m[1],m[2],m[3]];
  m=text.match(/複勝\s*([0-9]+)\s+([0-9]+)\s+([0-9]+)/);
  return m ? [m[1],m[2],m[3]] : [];
}
function parseTanFuku(html){
  const rows=[];
  const tr=[...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(x=>cleanText(x[1]));
  for(const row of tr){
    let m=row.match(/^\s*(\d+)\s+(\d+)\s+(.+?)\s+(\d+(?:\.\d+)?)\s+([\d.]+\s*[-－]\s*[\d.]+|\d+(?:\.\d+)?)\s+(\d+)\s+/);
    if(m){ rows.push({frameNo:+m[1],horseNo:String(m[2]),horseName:m[3].trim(),winOdds:+m[4],popularity:+m[6]}); continue; }
    m=row.match(/^\s*(\d+)\s+(\d+)\s+(.+?)\s+(\d+(?:\.\d+)?)\s+/);
    if(m && +m[2] <= 18) rows.push({frameNo:+m[1],horseNo:String(m[2]),horseName:m[3].trim(),winOdds:+m[4],popularity:null});
  }
  if(rows.length){
    [...rows].sort((a,b)=>a.winOdds-b.winOdds).forEach((x,i)=>{
      const target=rows.find(y=>y.horseNo===x.horseNo); if(target && !target.popularity) target.popularity=i+1;
    });
  }
  return rows;
}
function parseActualTimes(html){
  const out={};
  const tr=[...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(x=>cleanText(x[1]));
  for(const row of tr){
    const tm=row.match(/(\d+):([0-5]\d(?:\.\d+)?)/); if(!tm) continue;
    const nums=[...row.matchAll(/(?:^|\s)(\d{1,2})(?=\s)/g)].map(m=>m[1]);
    const no=nums.find(n=>+n>=1 && +n<=18);
    if(no && !out[no]) out[no]=tm[0];
  }
  return out;
}
function narUrls(code,date,race){
  const q=new URLSearchParams({k_babaCode:code,k_raceDate:date.replaceAll("-","/"),k_raceNo:race}).toString();
  return {
    result:`https://www.keiba.go.jp/KeibaWeb/TodayRaceInfo/RaceMarkTable?${q}`,
    refund:`https://sp.keiba.go.jp/KeibaWebSP/TodayRaceInfo/S_RefundMoneyList?${q}`,
    odds:`https://www.keiba.go.jp/KeibaWeb_IPAT/TodayRaceInfo/OddsTanFuku_ipat?${q}`
  };
}
async function narSync(u,res){
  const code=u.searchParams.get("code"), date=u.searchParams.get("date"), race=u.searchParams.get("race");
  if(!code||!date||!race) return sendJson(res,400,{ok:false,error:"code,date,race are required"});
  const urls=narUrls(code,date,race);
  try{
    const [resultHtml,refundHtml,oddsHtml]=await Promise.all([
      fetchText(urls.result).catch(()=>""), fetchText(urls.refund).catch(()=>""), fetchText(urls.odds).catch(()=>"")
    ]);
    const finishOrder=parseFinishOrder(refundHtml);
    const odds=parseTanFuku(oddsHtml);
    const actualTimes=parseActualTimes(resultHtml);
    return sendJson(res,200,{
      ok:true,source:"NAR公式",track:TRACK_NAMES[code]||"",code,date,race,
      finishOrder,actualTimes,odds,checkedAt:"NAR公式",
      pending:finishOrder.length<3,urls
    });
  }catch(e){ return sendJson(res,502,{ok:false,error:String(e?.message||e),source:"NAR公式",urls}); }
}
async function staticFile(u,res){
  let pathname=decodeURIComponent(u.pathname);
  if(pathname==="/") pathname="/index.html";
  const safe=path.normalize(pathname).replace(/^(\.\.(\/|\\|$))+/,"");
  const file=path.join(PUBLIC,safe);
  if(!file.startsWith(PUBLIC)){res.writeHead(403);return res.end("Forbidden");}
  try{
    const data=await fs.readFile(file);
    res.writeHead(200,{"content-type":MIME[path.extname(file)]||"application/octet-stream"});
    return res.end(data);
  }catch{
    try{
      const data=await fs.readFile(path.join(PUBLIC,"index.html"));
      res.writeHead(200,{"content-type":"text/html; charset=utf-8"});
      return res.end(data);
    }catch{res.writeHead(404);return res.end("Not Found");}
  }
}
http.createServer(async(req,res)=>{
  if(req.method==="OPTIONS"){res.writeHead(204,cors);return res.end();}
  const u=new URL(req.url,`http://${req.headers.host||"localhost"}`);
  if(u.pathname==="/api/health") return sendJson(res,200,{ok:true,service:"chass-keiba-lab",version:"7.1"});
  if(u.pathname==="/api/nar/sync") return narSync(u,res);
  return staticFile(u,res);
}).listen(PORT,"0.0.0.0",()=>console.log(`CHASS KEIBA LAB Ver.7.1 :${PORT}`));
