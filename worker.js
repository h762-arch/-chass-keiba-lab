const TRACK_NAMES={3:"帯広",10:"盛岡",11:"水沢",18:"浦和",19:"船橋",20:"大井",21:"川崎",22:"笠松",23:"金沢",24:"名古屋",27:"園田",28:"姫路",31:"高知",32:"佐賀",36:"門別"};
function json(data,status=200){return new Response(JSON.stringify(data,null,2),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}})}
function fmtDate(d){return String(d||"").replaceAll("-","/")}
function cleanText(html=""){return String(html).replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<br\s*\/?>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&").replace(/\s+/g," ").trim()}
function tableRows(html=""){return [...String(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(m=>{const cells=[...m[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(x=>cleanText(x[1]));return {cells,text:cells.join(" ")}})}
async function fetchText(url){const r=await fetch(url,{headers:{"user-agent":"Mozilla/5.0 (compatible; ChassKeibaLab/9.2)","accept":"text/html,application/xhtml+xml","accept-language":"ja"},redirect:"follow"});if(!r.ok)throw new Error(`NAR HTTP ${r.status}`);return r.text()}
function parseResult(html){
 const order=[],actualTimes={};
 for(const row of tableRows(html)){
   const c=row.cells;if(c.length<4)continue;
   const pos=String(c[0]||"").match(/^(\d{1,2})$/);if(!pos)continue;
   const nums=[];for(let i=1;i<Math.min(c.length,7);i++){const m=String(c[i]||"").match(/^(\d{1,2})$/);if(m&&Number(m[1])>=1&&Number(m[1])<=18)nums.push(m[1]);}
   const horseNo=nums.length>=2?nums[1]:nums[0];if(!horseNo)continue;
   const p=Number(pos[1]);if(p>=1&&p<=3)order[p-1]=horseNo;
   const tm=row.text.match(/\b(\d+):([0-5]\d(?:\.\d+)?)\b/);if(tm)actualTimes[horseNo]=tm[0];
 }
 return {finishOrder:order.filter(Boolean),actualTimes};
}
function parseTanFuku(html){
 const out=[];
 for(const row of tableRows(html)){
   const c=row.cells;if(c.length<4)continue;
   // Typical NAR table: 枠番 / 馬番 / 馬名 / 単勝 / 複勝...
   const frame=String(c[0]||"").match(/^(\d{1,2})$/)?.[1];
   const no=String(c[1]||"").match(/^(\d{1,2})$/)?.[1];
   if(!no||Number(no)<1||Number(no)>18)continue;
   const name=String(c[2]||"").trim();
   let odds=null;
   // Prefer the cell immediately following horse name.
   const cand=String(c[3]||"").replace(/,/g,"").match(/(\d+(?:\.\d+)?)/);
   if(cand){const v=Number(cand[1]);if(Number.isFinite(v)&&v>=1&&v<1000)odds=v;}
   if(odds==null)continue;
   out.push({frameNo:frame?Number(frame):null,horseNo:String(Number(no)),horseName:name,odds});
 }
 const byNo=new Map();for(const x of out)if(!byNo.has(x.horseNo))byNo.set(x.horseNo,x);
 const result=[...byNo.values()];
 [...result].sort((a,b)=>a.odds-b.odds).forEach((x,i)=>x.popularity=i+1);
 return result;
}
export default{
 async fetch(request,env){
  const u=new URL(request.url);
  if(u.pathname==="/api/health")return json({ok:true,version:"9.2",service:"chass-keiba-lab"});
  if(u.pathname==="/api/nar/odds"||u.pathname==="/api/nar/sync"){
    const code=u.searchParams.get("code"),date=u.searchParams.get("date"),race=u.searchParams.get("race");
    if(!code||!date||!race)return json({error:"code,date,race are required"},400);
    const q=`k_babaCode=${encodeURIComponent(code)}&k_raceDate=${encodeURIComponent(fmtDate(date))}&k_raceNo=${encodeURIComponent(race)}`;
    const urls={
      result:`https://www.keiba.go.jp/KeibaWeb/TodayRaceInfo/RaceMarkTable?${q}`,
      odds:`https://www.keiba.go.jp/KeibaWeb/TodayRaceInfo/OddsTanFuku?${q}`
    };
    try{
      if(u.pathname==="/api/nar/odds"){
        const oh=await fetchText(urls.odds),oo=parseTanFuku(oh);
        return json({source:"NAR公式",version:"9.2",track:TRACK_NAMES[Number(code)]||"",code,date,race,odds:oo,acquiredAt:new Date().toISOString()});
      }
      const [rh,oh]=await Promise.all([fetchText(urls.result).catch(()=>""),fetchText(urls.odds).catch(()=>"")]);
      const rr=parseResult(rh),oo=parseTanFuku(oh);
      return json({source:"NAR公式",version:"9.2",track:TRACK_NAMES[Number(code)]||"",code,date,race,...rr,odds:oo,acquiredAt:new Date().toISOString(),pending:rr.finishOrder.length<3});
    }catch(e){return json({error:String(e?.message||e)},502)}
  }
  if(env?.ASSETS){const reqUrl=new URL(request.url);if(u.pathname==="/")reqUrl.pathname="/index.html";return env.ASSETS.fetch(new Request(reqUrl,request))}
  return new Response("Not Found",{status:404});
 }
};
