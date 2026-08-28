const TRACK_NAMES={3:"帯広",10:"盛岡",11:"水沢",18:"浦和",19:"船橋",20:"大井",21:"川崎",22:"笠松",23:"金沢",24:"名古屋",27:"園田",28:"姫路",31:"高知",32:"佐賀",36:"門別"};
function json(data,status=200){return new Response(JSON.stringify(data,null,2),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}})}
function fmtDate(d){return String(d||"").replaceAll("-","/")}
function cleanText(html=""){return String(html).replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<br\s*\/?>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&").replace(/\s+/g," ").trim()}
function tableRows(html=""){return [...String(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(m=>{const cells=[...m[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(x=>cleanText(x[1]));return {cells,text:cells.join(" ")}})}
async function fetchText(url){const r=await fetch(url,{headers:{"user-agent":"Mozilla/5.0 (compatible; ChassKeibaLab/9.4)","accept":"text/html,application/xhtml+xml","accept-language":"ja"},redirect:"follow"});if(!r.ok)throw new Error(`NAR HTTP ${r.status}`);return r.text()}
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

function parseRaceMeta(html){
 const text=cleanText(html);
 const dists=[...text.matchAll(/(?:ダート|芝|右|左|外|内)?\s*(\d{3,4})\s*m/gi)]
   .map(m=>Number(m[1])).filter(v=>v>=800&&v<=3600);
 const distance=dists.length?dists[0]:null;
 const weather=text.match(/天候[:：]?\s*(晴|曇|雨|雪)/)?.[1]||'';
 const trackCondition=text.match(/(?:馬場|馬場状態)[:：]?\s*(良|稍重|重|不良)/)?.[1]||'不明';

 let raceName='';
 const candidates=[
   ...[...String(html).matchAll(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi)].map(m=>cleanText(m[1])),
   ...[...String(html).matchAll(/<title[^>]*>([\s\S]*?)<\/title>/gi)].map(m=>cleanText(m[1]))
 ].filter(Boolean);
 raceName=candidates.find(x=>!/(地方競馬情報サイト|NAR|Keiba|競馬情報)/i.test(x)&&x.length>=2&&x.length<=100)||'';
 raceName=raceName.replace(/^\d{1,2}R\s*/,'').trim();

 return {raceName,distance,weather,trackCondition,surface:/芝\s*\d{3,4}\s*m/.test(text)?'芝':'ダート'};
}
function parseRaceCard(html){
 const out=[];
 for(const row of tableRows(html)){
   const c=row.cells;if(c.length<3)continue;
   let no=null,name='',start=0;
   const c0=String(c[0]||''),c1=String(c[1]||''),c2=String(c[2]||'');
   if(/^\d{1,2}$/.test(c1)&&Number(c1)>=1&&Number(c1)<=18){no=String(Number(c1));name=c2;start=3;}
   else if(/^\d{1,2}$/.test(c0)&&Number(c0)>=1&&Number(c0)<=18){no=String(Number(c0));name=c1;start=2;}
   if(!no||!name||/馬番|馬名/.test(name))continue;
   let weight=null,sexAge='',jockey='',trainer='';
   for(let i=start;i<c.length;i++){
     const s=String(c[i]||'').trim();
     if(!sexAge&&/^[牡牝セ騙]\d+$/.test(s))sexAge=s;
     const wm=s.match(/^(\d{2}(?:\.\d)?)$/);
     if(weight==null&&wm){const v=Number(wm[1]);if(v>=45&&v<=65)weight=v;}
   }
   // Best-effort textual labels, without assuming fixed NAR columns.
   const texts=c.slice(start).filter(x=>x&&!/^\d+(?:\.\d+)?$/.test(String(x)));
   if(texts.length)jockey=String(texts[0]||'').trim();
   if(texts.length>1)trainer=String(texts[texts.length-1]||'').trim();
   out.push({horseNo:no,horseName:name.trim(),weight,sexAge,jockey,trainer});
 }
 const byNo=new Map();for(const x of out)if(!byNo.has(x.horseNo))byNo.set(x.horseNo,x);
 return [...byNo.values()].sort((a,b)=>Number(a.horseNo)-Number(b.horseNo));
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
  if(u.pathname==="/api/health")return json({ok:true,version:"9.4",service:"chass-keiba-lab"});

  if(u.pathname==="/api/nar/race"){
    const code=u.searchParams.get("code"),date=u.searchParams.get("date"),race=u.searchParams.get("race");
    if(!code||!date||!race)return json({error:"code,date,race are required"},400);
    const q=`k_babaCode=${encodeURIComponent(code)}&k_raceDate=${encodeURIComponent(fmtDate(date))}&k_raceNo=${encodeURIComponent(race)}`;
    const urls={
      card:`https://www.keiba.go.jp/KeibaWeb/TodayRaceInfo/RaceMarkTable?${q}`,
      odds:`https://www.keiba.go.jp/KeibaWeb/TodayRaceInfo/OddsTanFuku?${q}`
    };
    try{
      const [ch,oh]=await Promise.all([fetchText(urls.card),fetchText(urls.odds).catch(()=>"")]);
      const meta=parseRaceMeta(ch),cardHorses=parseRaceCard(ch),odds=parseTanFuku(oh);
      const cm=new Map(cardHorses.map(x=>[String(x.horseNo),x]));
      const om=new Map(odds.map(x=>[String(x.horseNo),x]));
      const numbers=[...new Set([...cardHorses.map(x=>String(x.horseNo)),...odds.map(x=>String(x.horseNo))])].sort((a,b)=>Number(a)-Number(b));
      const merged=numbers.map(no=>{
        const c=cm.get(no)||{},o=om.get(no)||{};
        const cardName=String(c.horseName||'').trim(),oddsName=String(o.horseName||'').trim();
        const cardBad=!cardName||/^\d{1,2}$/.test(cardName)||/^馬番\d+$/.test(cardName);
        return {
          ...c,horseNo:no,
          horseName:(!cardBad?cardName:oddsName)||cardName||`馬番${no}`,
          odds:o.odds??null,popularity:o.popularity??null,
          nameSource:(!cardBad?cardName:oddsName)?(!cardBad?'出馬表':'オッズ表'):'fallback'
        };
      });
      return json({source:"NAR公式",version:"9.4",track:TRACK_NAMES[Number(code)]||"",code,date,race,...meta,horses:merged,odds,quality:{horseNames:merged.filter(x=>x.horseName&&!/^馬番/.test(x.horseName)).length,total:merged.length},acquiredAt:new Date().toISOString()});
    }catch(e){return json({error:String(e?.message||e)},502)}
  }

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
        return json({source:"NAR公式",version:"9.4",track:TRACK_NAMES[Number(code)]||"",code,date,race,odds:oo,acquiredAt:new Date().toISOString()});
      }
      const [rh,oh]=await Promise.all([fetchText(urls.result).catch(()=>""),fetchText(urls.odds).catch(()=>"")]);
      const rr=parseResult(rh),oo=parseTanFuku(oh);
      return json({source:"NAR公式",version:"9.4",track:TRACK_NAMES[Number(code)]||"",code,date,race,...rr,odds:oo,acquiredAt:new Date().toISOString(),pending:rr.finishOrder.length<3});
    }catch(e){return json({error:String(e?.message||e)},502)}
  }
  if(env?.ASSETS){const reqUrl=new URL(request.url);if(u.pathname==="/")reqUrl.pathname="/index.html";return env.ASSETS.fetch(new Request(reqUrl,request))}
  return new Response("Not Found",{status:404});
 }
};
