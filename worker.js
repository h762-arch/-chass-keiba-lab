const TRACK_NAMES = {19:"船橋",22:"笠松",27:"園田",28:"姫路",36:"門別"};
const PUBLIC_PATHS = new Set(["/","/index.html","/app.js","/styles.css","/manifest.webmanifest"]);

function json(data,status=200){return new Response(JSON.stringify(data,null,2),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});}
function fmtDate(date){return String(date||"").replaceAll("-","/");}
function cleanText(html=""){return String(html).replace(/<script[\\s\\S]*?<\\/script>/gi," ").replace(/<style[\\s\\S]*?<\\/style>/gi," ").replace(/<br\\s*\\/?>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&").replace(/\\s+/g," ").trim();}
function tableRows(html=""){return [...String(html).matchAll(/<tr\\b[^>]*>([\\s\\S]*?)<\\/tr>/gi)].map(m=>{const cells=[...m[1].matchAll(/<t[dh]\\b[^>]*>([\\s\\S]*?)<\\/t[dh]>/gi)].map(x=>cleanText(x[1]));return {cells,text:cells.join(" ").replace(/\\s+/g," ").trim()};});}
async function fetchText(url){const r=await fetch(url,{headers:{"user-agent":"Mozilla/5.0 (compatible; ChassKeibaLab/7.3; +https://www.keiba.go.jp/)","accept":"text/html,application/xhtml+xml","accept-language":"ja,en;q=0.8"},redirect:"follow"});if(!r.ok)throw new Error(`NAR HTTP ${r.status}`);return r.text();}

function parseFinishOrderFromRefund(html){
  const t=cleanText(html);
  let m=t.match(/三連単\\s*([0-9]+)\\s*[-－]\\s*([0-9]+)\\s*[-－]\\s*([0-9]+)/);
  if(m)return [m[1],m[2],m[3]];
  m=t.match(/複勝\\s*([0-9]+)\\s+([0-9]+)\\s+([0-9]+)/);
  return m?[m[1],m[2],m[3]]:[];
}

function parseRaceResult(html){
  const finishOrder=[],actualTimes={};
  for(const row of tableRows(html)){
    const c=row.cells;if(c.length<4)continue;
    const pos=String(c[0]||"").match(/^(\\d{1,2})$/);if(!pos)continue;
    const nums=[];
    for(let i=1;i<Math.min(c.length,6);i++){const m=String(c[i]||"").match(/^(\\d{1,2})$/);if(m&&Number(m[1])>=1&&Number(m[1])<=18)nums.push(m[1]);}
    const horseNo=nums.length>=2?nums[1]:nums[0];if(!horseNo)continue;
    const p=Number(pos[1]);if(p>=1&&p<=3)finishOrder[p-1]=horseNo;
    const tm=row.text.match(/\\b(\\d+):([0-5]\\d(?:\\.\\d+)?)\\b/);if(tm)actualTimes[horseNo]=tm[0];
  }
  return {finishOrder:finishOrder.filter(Boolean),actualTimes};
}

function parseTanFuku(html){
  const rows=[],text=cleanText(html);
  const checked=(text.match(/（\\s*(\\d{1,2}:\\d{2}\\s*現在|最終)\\s*）/)||[])[1]||(text.includes("最終")?"最終":"NAR公式");
  for(const row of tableRows(html)){
    let m=row.text.match(/^\\s*(\\d+)\\s+(\\d+)\\s+(.+?)\\s+(\\d+(?:\\.\\d+)?)\\s+/);
    if(!m||Number(m[2])>18)continue;
    rows.push({frameNo:Number(m[1]),horseNo:String(Number(m[2])),horseName:m[3].trim(),winOdds:Number(m[4]),popularity:null});
  }
  const byNo=new Map();for(const x of rows)if(!byNo.has(x.horseNo))byNo.set(x.horseNo,x);
  const out=[...byNo.values()].filter(x=>Number.isFinite(x.winOdds)&&x.winOdds>=1);
  [...out].sort((a,b)=>a.winOdds-b.winOdds).forEach((x,i)=>x.popularity=i+1);
  return {checkedAt:checked,odds:out};
}

export default {
  async fetch(request,env){
    const u=new URL(request.url);
    if(u.pathname==="/api/health")return json({ok:true,version:"7.3",service:"chass-keiba-lab"});
    if(u.pathname==="/api/nar/sync"){
      const code=u.searchParams.get("code"),date=u.searchParams.get("date"),race=u.searchParams.get("race");
      if(!code||!date||!race)return json({error:"code,date,race are required"},400);
      const q=`k_babaCode=${encodeURIComponent(code)}&k_raceDate=${encodeURIComponent(fmtDate(date))}&k_raceNo=${encodeURIComponent(race)}`;
      const urls={
        result:`https://www.keiba.go.jp/KeibaWeb/TodayRaceInfo/RaceMarkTable?${q}`,
        resultIpat:`https://www.keiba.go.jp/KeibaWeb_IPAT/TodayRaceInfo/RaceMarkTable_ipat?${q}`,
        odds:`https://www.keiba.go.jp/KeibaWeb/TodayRaceInfo/OddsTanFuku?${q}`,
        oddsIpat:`https://www.keiba.go.jp/KeibaWeb_IPAT/TodayRaceInfo/OddsTanFuku_ipat?${q}`,
        refund:`https://sp.keiba.go.jp/KeibaWebSP/TodayRaceInfo/S_RefundMoneyList?${q}`
      };
      try{
        const [rh,rih,oh,oih,fh]=await Promise.all(Object.values(urls).map(x=>fetchText(x).catch(()=>'')));
        const a=rh?parseRaceResult(rh):{finishOrder:[],actualTimes:{}};
        const b=rih?parseRaceResult(rih):{finishOrder:[],actualTimes:{}};
        let finishOrder=a.finishOrder.length>=3?a.finishOrder:b.finishOrder;
        if(finishOrder.length<3&&fh)finishOrder=parseFinishOrderFromRefund(fh);
        const actualTimes=Object.keys(a.actualTimes).length?a.actualTimes:b.actualTimes;
        let market=oh?parseTanFuku(oh):{checkedAt:"",odds:[]};
        if(!market.odds.length&&oih)market=parseTanFuku(oih);
        return json({source:"NAR公式",version:"7.3",track:TRACK_NAMES[Number(code)]||"",code,date,race,finishOrder,actualTimes,...market,pending:finishOrder.length<3,sources:{result:!!rh,resultIpat:!!rih,odds:!!oh,oddsIpat:!!oih,refund:!!fh},urls});
      }catch(e){return json({error:String(e?.message||e),source:"NAR公式",version:"7.3"},502);}
    }
    if(PUBLIC_PATHS.has(u.pathname)&&env?.ASSETS){const a=new URL(request.url);if(u.pathname==="/")a.pathname="/index.html";return env.ASSETS.fetch(new Request(a,request));}
    return new Response("Not Found",{status:404});
  }
};
