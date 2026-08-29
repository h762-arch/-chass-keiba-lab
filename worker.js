const TRACK_NAMES={3:"帯広",10:"盛岡",11:"水沢",18:"浦和",19:"船橋",20:"大井",21:"川崎",22:"笠松",23:"金沢",24:"名古屋",27:"園田",28:"姫路",31:"高知",32:"佐賀",36:"門別"};
const VERSION="9.6";
function json(data,status=200){return new Response(JSON.stringify(data,null,2),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}})}
function fmtDate(d){return String(d||"").replaceAll("-","/")}
function cleanText(html=""){return String(html).replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<br\s*\/?>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&").replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/\s+/g," ").trim()}
function tableRows(html=""){return [...String(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(m=>{const cells=[...m[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(x=>cleanText(x[1]));return {cells,text:cells.join(" ")}})}
async function fetchText(url){const r=await fetch(url,{headers:{"user-agent":`Mozilla/5.0 (compatible; ChassKeibaLab/${VERSION})`,"accept":"text/html,application/xhtml+xml","accept-language":"ja"},redirect:"follow"});if(!r.ok)throw new Error(`NAR HTTP ${r.status}`);return r.text()}
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;

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
 const dists=[...text.matchAll(/(?:ダート|芝|右|左|外|内)?\s*(\d{3,4})\s*m/gi)].map(m=>Number(m[1])).filter(v=>v>=800&&v<=3600);
 const distance=dists.length?dists[0]:null;
 const weather=text.match(/天候[:：]?\s*(晴|曇|雨|雪)/)?.[1]||'';
 const trackCondition=text.match(/(?:馬場|馬場状態)[:：]?\s*(良|稍重|重|不良)/)?.[1]||'不明';
 const candidates=[...[...String(html).matchAll(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi)].map(m=>cleanText(m[1])),...[...String(html).matchAll(/<title[^>]*>([\s\S]*?)<\/title>/gi)].map(m=>cleanText(m[1]))].filter(Boolean);
 let raceName=candidates.find(x=>!/(地方競馬情報サイト|NAR|Keiba|競馬情報)/i.test(x)&&x.length>=2&&x.length<=100)||'';
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
     if(!sexAge&&/^[牡牝セ騙]\s*\d+$/.test(s))sexAge=s.replace(/\s+/g,'');
     const wm=s.match(/^(\d{2}(?:\.\d)?)$/);if(weight==null&&wm){const v=Number(wm[1]);if(v>=45&&v<=65)weight=v;}
   }
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
   const frame=String(c[0]||"").match(/^(\d{1,2})$/)?.[1];
   const no=String(c[1]||"").match(/^(\d{1,2})$/)?.[1];if(!no||Number(no)<1||Number(no)>18)continue;
   const name=String(c[2]||"").trim();
   const cand=String(c[3]||"").replace(/,/g,"").match(/(\d+(?:\.\d+)?)/);if(!cand)continue;
   const odds=Number(cand[1]);if(!Number.isFinite(odds)||odds<1||odds>=1000)continue;
   out.push({frameNo:frame?Number(frame):null,horseNo:String(Number(no)),horseName:name,odds});
 }
 const byNo=new Map();for(const x of out)if(!byNo.has(x.horseNo))byNo.set(x.horseNo,x);
 const result=[...byNo.values()];[...result].sort((a,b)=>a.odds-b.odds).forEach((x,i)=>x.popularity=i+1);return result;
}
function compactTimeToSec(v){
 const s=String(v||'').replace(/\D/g,'');if(s.length<3||s.length>4)return null;
 const tenth=Number(s.at(-1)),sec=Number(s.slice(-3,-1)),min=Number(s.slice(0,-3)||0);
 if(sec>59)return null;return min*60+sec+tenth/10;
}
function locateHorseSegments(detailHtml,horses){
 const text=cleanText(detailHtml);let cursor=0;const parts=[];
 for(let i=0;i<horses.length;i++){
   const name=String(horses[i].horseName||'').trim();if(!name){parts.push('');continue;}
   let at=text.indexOf(name,cursor);if(at<0)at=text.indexOf(name);if(at<0){parts.push('');continue;}
   let end=text.length;
   for(let j=i+1;j<horses.length;j++){const next=String(horses[j].horseName||'').trim();if(!next)continue;const ni=text.indexOf(next,at+name.length);if(ni>=0){end=ni;break;}}
   parts.push(text.slice(at,end));cursor=at+name.length;
 }
 return parts;
}
function parseRuns(segment,targetDistance,trackName){
 const runs=[];
 // NAR DebaTableSmall actual format:
 // 船橋08.06 良 左 1200 ... 5/7 2人 ... 1159（2.3） 2-2-1 39.5
 // Ver.9.5 incorrectly expected "着順 YY.MM.DD". Ver.9.6 anchors on the real MM.DD block.
 const re=/([^\s]{0,8}?)(\d{2}\.\d{2})\s*(良|稍重|重|不良)\s*(?:ナ\s*)?(右|左|直|外|内)?\s*(\d{3,4})/g;
 const hits=[...segment.matchAll(re)].slice(0,5);
 for(let i=0;i<hits.length;i++){
   const m=hits[i],start=m.index,end=i+1<hits.length?hits[i+1].index:Math.min(segment.length,start+420);
   const chunk=segment.slice(start,end);
   const finishField=chunk.match(/(?:^|\s)(\d{1,2})\/(\d{1,2})\s+\d+人/);
   if(!finishField)continue;
   const finish=Number(finishField[1]),fieldSize=Number(finishField[2]);
   if(!Number.isFinite(finish)||finish<1||finish>fieldSize||fieldSize<2)continue;
   const dist=Number(m[5])||null;
   const compact=chunk.match(/\b(\d{3,4})（[^）]*）/)?.[1]||null;
   const timeSec=compactTimeToSec(compact);
   const corners=chunk.match(/\b(\d{1,2}(?:-\d{1,2}){1,4})\b/)?.[1]||'';
   const decimals=[...chunk.matchAll(/\b([2-5]\d\.\d)\b/g)].map(x=>Number(x[1])).filter(v=>v>=30&&v<=55);
   const last3f=decimals.length?decimals[decimals.length-1]:null;
   const venue=(String(m[1]||'').match(/[一-龠々ヶァ-ヶー]+/)||[])[0]||'';
   const exactDistance=!!(dist&&targetDistance&&dist===targetDistance);
   const nearDistance=!!(dist&&targetDistance&&Math.abs(dist-targetDistance)<=100);
   const sameTrack=!!(trackName&&(venue===trackName||chunk.startsWith(trackName)||chunk.includes(trackName+m[2])));
   let score=clamp(104-(finish-1)*6.5,40,104);
   if(exactDistance)score+=6;else if(nearDistance)score+=2;
   if(sameTrack)score+=3;
   if(last3f!=null)score+=clamp((41-last3f)*1.15,-8,8);
   runs.push({
     finish,fieldSize,date:m[2],condition:m[3],venue,distance:dist,timeSec,last3f,corners,
     exactDistance,nearDistance,sameDistance:exactDistance,sameTrack,
     score:clamp(score,30,110)
   });
 }
 return runs;
}
function secToRaceTime(sec){
 if(!Number.isFinite(sec)||sec<=0)return '';
 const m=Math.floor(sec/60),s=(sec-m*60).toFixed(1).padStart(4,'0');
 return `${m}:${s}`;
}
function predictTimeFromRuns(runs,targetDistance){
 const exact=(runs||[]).filter(r=>r.distance===targetDistance&&Number.isFinite(r.timeSec)).slice(0,3);
 if(!exact.length)return '';
 const weights=[1,.82,.68].slice(0,exact.length);
 const den=weights.reduce((a,b)=>a+b,0);
 const sec=exact.reduce((s,r,i)=>s+r.timeSec*weights[i],0)/den;
 return secToRaceTime(sec);
}
function enrichAbility(detailHtml,horses,targetDistance,trackName){
 const segments=locateHorseSegments(detailHtml,horses);
 const enriched=horses.map((h,i)=>{
   const runs=parseRuns(segments[i]||'',targetDistance,trackName);
   const recentIndex=runs.map(r=>Math.round(r.score));
   const sameD=runs.filter(r=>r.sameDistance),sameC=runs.filter(r=>r.sameTrack);
   const avg=mean(recentIndex),distScore=mean(sameD.map(r=>r.score)),courseScore=mean(sameC.map(r=>r.score));
   const firstCorners=runs.map(r=>Number(String(r.corners).split('-')[0])).filter(n=>Number.isFinite(n));
   const cornerAvg=mean(firstCorners);const runningStyle=cornerAvg==null?'不明':cornerAvg<=2.3?'逃げ・先行':cornerAvg<=5?'先行・好位':'差し・追込';
   return {...h,runs,recentIndex,fiveRaceAvgIndex:avg==null?null:Math.round(avg),distanceIndex:distScore==null?null:Math.round(distScore),courseIndex:courseScore==null?null:Math.round(courseScore),runningStyle,predictedTime:predictTimeFromRuns(runs,targetDistance),dataConfidence:Math.round(clamp(38+runs.length*8+sameD.length*4+sameC.length*2,38,92))};
 });
 const sameDistanceTimes=enriched.flatMap(h=>h.runs.filter(r=>r.sameDistance&&r.timeSec!=null).map(r=>r.timeSec));
 const best=sameDistanceTimes.length?Math.min(...sameDistanceTimes):null,worst=sameDistanceTimes.length?Math.max(...sameDistanceTimes):null;
 enriched.forEach(h=>{
   const own=h.runs.filter(r=>r.sameDistance&&r.timeSec!=null).map(r=>r.timeSec);const ownBest=own.length?Math.min(...own):null;
   h.timeIndex=ownBest==null?null:(best===worst?78:Math.round(clamp(95-35*(ownBest-best)/(worst-best),55,95)));
   const abilityParts=[h.timeIndex,h.fiveRaceAvgIndex,h.distanceIndex,h.courseIndex].filter(v=>v!=null);
   h.abilityScore=abilityParts.length?mean(abilityParts):null;
   const facts=[];if(h.recentIndex.length)facts.push(`近${h.recentIndex.length}走指数 ${h.recentIndex.join('→')}`);if(h.timeIndex!=null)facts.push(`同距離時計指数 ${h.timeIndex}`);if(h.distanceIndex!=null)facts.push(`距離適性 ${h.distanceIndex}`);if(h.courseIndex!=null)facts.push(`コース適性 ${h.courseIndex}`);
   h.reason=facts.length?`NAR公式過去走から市場非依存で算出：${facts.join(' / ')}。オッズは能力計算に未使用。`:'NAR公式出馬表は取得済みですが、解析可能な過去走が不足しています。';
 });
 const scored=enriched.filter(h=>h.abilityScore!=null);
 if(scored.length>=2){
   const max=Math.max(...scored.map(h=>h.abilityScore));
   const ex=scored.map(h=>({h,x:Math.exp((h.abilityScore-max)/7)}));
   const sum=ex.reduce((s,z)=>s+z.x,0)||1;
   ex.forEach(z=>{const p=z.x/sum;z.h.abilityWinRate=clamp(p*100,0.5,70);z.h.abilityPriorOdds=clamp(1/p,1.05,999);});
 }
 return enriched;
}

export default{
 async fetch(request,env){
  const u=new URL(request.url);
  if(u.pathname==="/api/health")return json({ok:true,version:VERSION,service:"chass-keiba-lab"});
  if(u.pathname==="/api/nar/race"){
    const code=u.searchParams.get("code"),date=u.searchParams.get("date"),race=u.searchParams.get("race");if(!code||!date||!race)return json({error:"code,date,race are required"},400);
    const q=`k_babaCode=${encodeURIComponent(code)}&k_raceDate=${encodeURIComponent(fmtDate(date))}&k_raceNo=${encodeURIComponent(race)}`;
    const urls={card:`https://www.keiba.go.jp/KeibaWeb/TodayRaceInfo/RaceMarkTable?${q}`,detail:`https://www.keiba.go.jp/KeibaWeb/TodayRaceInfo/DebaTableSmall?${q}`,odds:`https://www.keiba.go.jp/KeibaWeb/TodayRaceInfo/OddsTanFuku?${q}`};
    try{
      const [ch,dh,oh]=await Promise.all([fetchText(urls.card),fetchText(urls.detail).catch(()=>""),fetchText(urls.odds).catch(()=>"")]);
      const meta=parseRaceMeta(dh||ch),cardHorses=parseRaceCard(ch),odds=parseTanFuku(oh),track=TRACK_NAMES[Number(code)]||"";
      const enriched=enrichAbility(dh,cardHorses,meta.distance,track),cm=new Map(enriched.map(x=>[String(x.horseNo),x])),om=new Map(odds.map(x=>[String(x.horseNo),x]));
      const numbers=[...new Set([...enriched.map(x=>String(x.horseNo)),...odds.map(x=>String(x.horseNo))])].sort((a,b)=>Number(a)-Number(b));
      const merged=numbers.map(no=>{const c=cm.get(no)||{},o=om.get(no)||{};const cardName=String(c.horseName||'').trim(),oddsName=String(o.horseName||'').trim();const cardBad=!cardName||/^\d{1,2}$/.test(cardName)||/^馬番\d+$/.test(cardName);return {...c,horseNo:no,horseName:(!cardBad?cardName:oddsName)||cardName||`馬番${no}`,odds:o.odds??null,popularity:o.popularity??null,nameSource:(!cardBad?cardName:oddsName)?(!cardBad?'出馬表':'オッズ表'):'fallback'};});
      const abilityCount=merged.filter(x=>x.abilityScore!=null).length;
      return json({source:"NAR公式",version:VERSION,track,code,date,race,...meta,horses:merged,odds,quality:{horseNames:merged.filter(x=>x.horseName&&!/^馬番/.test(x.horseName)).length,total:merged.length,abilityData:abilityCount,abilityRate:merged.length?Math.round(100*abilityCount/merged.length):0,marketSeparated:true,parser:"DebaTableSmall-MM.DD-v9.6",predictedTime:merged.filter(x=>x.predictedTime).length},acquiredAt:new Date().toISOString()});
    }catch(e){return json({error:String(e?.message||e)},502)}
  }
  if(u.pathname==="/api/nar/odds"||u.pathname==="/api/nar/sync"){
    const code=u.searchParams.get("code"),date=u.searchParams.get("date"),race=u.searchParams.get("race");if(!code||!date||!race)return json({error:"code,date,race are required"},400);
    const q=`k_babaCode=${encodeURIComponent(code)}&k_raceDate=${encodeURIComponent(fmtDate(date))}&k_raceNo=${encodeURIComponent(race)}`;const urls={result:`https://www.keiba.go.jp/KeibaWeb/TodayRaceInfo/RaceMarkTable?${q}`,odds:`https://www.keiba.go.jp/KeibaWeb/TodayRaceInfo/OddsTanFuku?${q}`};
    try{
      if(u.pathname==="/api/nar/odds"){const oh=await fetchText(urls.odds),oo=parseTanFuku(oh);return json({source:"NAR公式",version:VERSION,track:TRACK_NAMES[Number(code)]||"",code,date,race,odds:oo,acquiredAt:new Date().toISOString()});}
      const [rh,oh]=await Promise.all([fetchText(urls.result).catch(()=>""),fetchText(urls.odds).catch(()=>"")]);const rr=parseResult(rh),oo=parseTanFuku(oh);return json({source:"NAR公式",version:VERSION,track:TRACK_NAMES[Number(code)]||"",code,date,race,...rr,odds:oo,acquiredAt:new Date().toISOString(),pending:rr.finishOrder.length<3});
    }catch(e){return json({error:String(e?.message||e)},502)}
  }
  if(env?.ASSETS){const reqUrl=new URL(request.url);if(u.pathname==="/")reqUrl.pathname="/index.html";return env.ASSETS.fetch(new Request(reqUrl,request))}
  return new Response("Not Found",{status:404});
 }
};