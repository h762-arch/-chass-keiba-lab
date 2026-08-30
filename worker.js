const TRACK_NAMES={3:"帯広",10:"盛岡",11:"水沢",18:"浦和",19:"船橋",20:"大井",21:"川崎",22:"笠松",23:"金沢",24:"名古屋",27:"園田",28:"姫路",31:"高知",32:"佐賀",36:"門別"};
export const VERSION="9.8.6";
function json(data,status=200){return new Response(JSON.stringify(data,null,2),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}})}
function errorPayload(e){const status=Number(e?.status)||0,raw=String(e?.message||e);let errorCode='nar_temporary';if(status===404)errorCode='race_not_found';else if(/parse|解析/i.test(raw))errorCode='parser_error';else if(/network|fetch|通信/i.test(raw))errorCode='network_error';return {error:raw,errorCode}}
function fmtDate(d){return String(d||"").replaceAll("-","/")}
function cleanText(html=""){return String(html).replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<br\s*\/?>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&").replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/\s+/g," ").trim()}
function rowBlocks(html=""){
 const parts=String(html).split(/<tr\b[^>]*>/i).slice(1);
 return parts.map(part=>part.split(/(?=<tr\b)|<\/tr\s*>/i)[0]);
}
function cellBlocks(rowHtml=""){
 const out=[];const re=/<t([dh])\b([^>]*)>/gi;const hits=[...String(rowHtml).matchAll(re)];
 for(let i=0;i<hits.length;i++){
   const start=hits[i].index+hits[i][0].length,end=i+1<hits.length?hits[i+1].index:String(rowHtml).length;
   out.push({tag:hits[i][1].toLowerCase(),attrs:hits[i][2]||'',html:String(rowHtml).slice(start,end).replace(/<\/t[dh]\s*>[\s\S]*$/i,''),text:''});
 }
 out.forEach(x=>x.text=cleanText(x.html));return out;
}
function tableRows(html=""){return rowBlocks(html).map(raw=>{const blocks=cellBlocks(raw),cells=blocks.map(x=>x.text);return {raw,blocks,cells,text:cells.join(" ")}})}
function plausibleHorseName(value=""){
 const s=cleanText(value).replace(/^[\s　]+|[\s　]+$/g,'');
 if(s.length<2||s.length>40)return false;
 if(/^\d+(?:[.,]\d+)?(?:円|倍|人気|番)?$/.test(s))return false;
 if(/[¥￥]|\d+\s*円/.test(s))return false;
 if(/^(?:馬|枠)?番|馬名|馬主|生産牧場|単勝|複勝|オッズ|人気(?:順位)?|金額|払戻|着順|騎手|調教師$/.test(s))return false;
 return /[一-龠々〆ヵヶぁ-んァ-ヶーA-Za-z]/.test(s);
}
async function fetchText(url){const r=await fetch(url,{headers:{"user-agent":`Mozilla/5.0 (compatible; ChassKeibaLab/${VERSION})`,"accept":"text/html,application/xhtml+xml","accept-language":"ja"},redirect:"follow"});if(!r.ok){const e=new Error(`NAR HTTP ${r.status}`);e.status=r.status;throw e}return r.text()}
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;

function resultColumn(headers,...patterns){return headers.findIndex(h=>patterns.some(p=>p.test(String(h||'').replace(/\s+/g,''))))}
function numericCell(v,min=-Infinity,max=Infinity){const m=String(v??'').replace(/,/g,'').match(/-?\d+(?:\.\d+)?/),n=m?Number(m[0]):null;return Number.isFinite(n)&&n>=min&&n<=max?n:null}
export function parseResult(html){
 const results=[],actualTimes={};let headers=[];
 for(const row of tableRows(html)){
   const c=row.cells.map(x=>String(x||'').trim()),joined=c.join('|');
   if(/着順/.test(joined)&&/馬番/.test(joined)){headers=c;continue}
   if(!headers.length||c.length<4)continue;
   const ix={position:resultColumn(headers,/^着順$/,/着順/),frameNo:resultColumn(headers,/枠番/,/^枠$/),horseNo:resultColumn(headers,/馬番/),horseName:resultColumn(headers,/馬名/),carriedWeight:resultColumn(headers,/斤量/),jockey:resultColumn(headers,/騎手/),time:resultColumn(headers,/タイム/,/走破時計/),margin:resultColumn(headers,/着差/),last3f:resultColumn(headers,/上り3F/,/上がり3F/,/^上り$/),corner:resultColumn(headers,/コーナー/,/通過順位/),popularity:resultColumn(headers,/人気/),odds:resultColumn(headers,/単勝/,/オッズ/),bodyWeight:resultColumn(headers,/馬体重/)};
   const at=k=>ix[k]>=0?c[ix[k]]:'';
   const positionText=at('position'),position=numericCell(positionText,1,99),horseNo=numericCell(at('horseNo'),1,99);
   if(horseNo==null||(!position&&!/(取消|除外|中止|失格)/.test(positionText)))continue;
   const horseName=plausibleHorseName(at('horseName'))?at('horseName'):'';
   const time=at('time').match(/\b\d+:[0-5]\d(?:\.\d+)?\b/)?.[0]||'';
   const bw=at('bodyWeight').match(/(\d{3,4})(?:\s*\(([+\-−]?\d+)\))?/);
   const item={position,positionText:position?String(position):positionText,frameNo:numericCell(at('frameNo'),1,8),horseNo,horseName,time,margin:at('margin')||'',last3f:numericCell(at('last3f'),25,60),cornerPositions:at('corner')||'',popularity:numericCell(at('popularity'),1,99),finalOdds:numericCell(at('odds'),1,9999),bodyWeight:bw?Number(bw[1]):null,bodyWeightChange:bw?.[2]!=null?Number(String(bw[2]).replace('−','-')):null,carriedWeight:numericCell(at('carriedWeight'),40,80),jockey:at('jockey')||''};
   results.push(item);if(time)actualTimes[String(horseNo)]=time;
 }
 if(!results.length){
   const legacyOrder=[];
   for(const row of tableRows(html)){
     const c=row.cells,pos=String(c[0]||'').match(/^(\d{1,2})$/);if(!pos||c.length<4)continue;
     const nums=[];for(let i=1;i<Math.min(c.length,7);i++){const m=String(c[i]||'').match(/^(\d{1,2})$/);if(m&&Number(m[1])>=1&&Number(m[1])<=18)nums.push(m[1])}
     const horseNo=Number(nums.length>=2?nums[1]:nums[0]);if(!horseNo)continue;const position=Number(pos[1]),time=row.text.match(/\b\d+:[0-5]\d(?:\.\d+)?\b/)?.[0]||'';
     if(position>=1&&position<=3)legacyOrder[position-1]=String(horseNo);if(time)actualTimes[String(horseNo)]=time;results.push({position,positionText:String(position),horseNo,horseName:'',time,parserFallback:true});
   }
   results.sort((a,b)=>a.position-b.position);return {finishOrder:legacyOrder.filter(Boolean),actualTimes,results,parserFallback:true};
 }
 results.sort((a,b)=>(a.position??999)-(b.position??999)||a.horseNo-b.horseNo);
 const finishOrder=results.filter(x=>x.position!=null).map(x=>String(x.horseNo));
 return {finishOrder,actualTimes,results};
}
export function parseRaceMeta(html){
 const text=cleanText(html);
 const dists=[...text.matchAll(/(?:ダート|芝|右|左|外|内)?\s*(\d{3,4})\s*[mｍ]/gi)].map(m=>Number(m[1])).filter(v=>v>=800&&v<=3600);
 const distance=dists.length?dists[0]:null;
 const weather=text.match(/天候[:：]?\s*(晴|曇|雨|雪)/)?.[1]||'';
 const trackCondition=text.match(/(?:馬場|馬場状態)[:：]?\s*(良|稍重|重|不良)/)?.[1]||'不明';
 const candidates=[...[...String(html).matchAll(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi)].map(m=>cleanText(m[1])),...[...String(html).matchAll(/<title[^>]*>([\s\S]*?)<\/title>/gi)].map(m=>cleanText(m[1]))].filter(Boolean);
 let raceName=candidates.find(x=>!/(地方競馬情報サイト|NAR|Keiba|競馬情報)/i.test(x)&&x.length>=2&&x.length<=100)||'';
 raceName=raceName.replace(/^\d{1,2}R\s*/,'').trim();
 return {raceName,distance,weather,trackCondition,surface:/芝\s*\d{3,4}\s*[mｍ]/.test(text)?'芝':'ダート'};
}
export function parseRaceCard(html){
 const out=[];
 for(const row of tableRows(html)){
   const c=row.cells;if(c.length<2)continue;
   const marked=row.raw.match(/<font\b[^>]*class=["']?bamei["']?[^>]*>[\s\S]*?<b[^>]*>([\s\S]*?)<\/b>/i);
   const nameIndex=marked?row.blocks.findIndex(x=>/class=["']?bamei/i.test(x.html)):-1;
   const before=c.slice(0,nameIndex>=0?nameIndex:c.length);
   const nums=before.map(x=>String(x).trim().match(/^(\d{1,2})$/)?.[1]).filter(x=>x&&Number(x)>=1&&Number(x)<=18);
   const no=nums.length?String(Number(nums.at(-1))):null;
   let name=marked?cleanText(marked[1]):'';
   if(!name&&no){
     const at=c.findIndex(x=>String(Number(String(x).trim()))===no);
     name=c.slice(at+1,Math.min(c.length,at+4)).find(plausibleHorseName)||'';
   }
   if(!no||!plausibleHorseName(name))continue;
   const start=Math.max(0,nameIndex+1);
   let weight=null,sexAge='',jockey='',trainer='';
   for(let i=start;i<c.length;i++){
     const s=String(c[i]||'').trim();
     if(!sexAge&&/^[牡牝セ騙]\s*\d+$/.test(s))sexAge=s.replace(/\s+/g,'');
     const wm=s.match(/^(\d{2}(?:\.\d)?)$/);if(weight==null&&wm){const v=Number(wm[1]);if(v>=45&&v<=65)weight=v;}
   }
   const texts=c.slice(start).filter(x=>x&&!/^\d+(?:\.\d+)?$/.test(String(x)));
   if(texts.length)jockey=String(texts[0]||'').trim();
   if(texts.length>1)trainer=String(texts[texts.length-1]||'').trim();
   out.push({horseNo:no,horseName:cleanText(name),weight,sexAge,jockey,trainer,rowHtml:row.raw});
 }
 const byNo=new Map();for(const x of out)if(!byNo.has(x.horseNo))byNo.set(x.horseNo,x);
 return [...byNo.values()].sort((a,b)=>Number(a.horseNo)-Number(b.horseNo));
}
export function parseTanFuku(html){
 const out=[];
 for(const row of tableRows(html)){
   const c=row.cells;if(c.length<4)continue;
   const frame=String(c[0]||"").match(/^(\d{1,2})$/)?.[1];
   const no=String(c[1]||"").match(/^(\d{1,2})$/)?.[1];if(!no||Number(no)<1||Number(no)>18)continue;
   const name=String(c[2]||"").trim();if(!plausibleHorseName(name))continue;
   const cand=String(c[3]||"").replace(/,/g,"").match(/(\d+(?:\.\d+)?)/);if(!cand)continue;
   const odds=Number(cand[1]);if(!Number.isFinite(odds)||odds<1||odds>=1000)continue;
   out.push({frameNo:frame?Number(frame):null,horseNo:String(Number(no)),horseName:name,odds});
 }
 const byNo=new Map();for(const x of out)if(!byNo.has(x.horseNo))byNo.set(x.horseNo,x);
 const result=[...byNo.values()];[...result].sort((a,b)=>a.odds-b.odds).forEach((x,i)=>x.popularity=i+1);return result;
}
export function compactTimeToSec(v){
 const s=String(v||'').replace(/\D/g,'');if(s.length<3||s.length>4)return null;
 const tenth=Number(s.at(-1)),sec=Number(s.slice(-3,-1)),min=Number(s.slice(0,-3)||0);
 if(sec>59)return null;return min*60+sec+tenth/10;
}
function locateHorseSegments(detailHtml,horses){
 const detailHorses=parseRaceCard(detailHtml),byNo=new Map(detailHorses.map(h=>[String(h.horseNo),h.rowHtml]));
 const byName=new Map(detailHorses.map(h=>[String(h.horseName),h.rowHtml]));
 return horses.map(h=>cleanText(byNo.get(String(h.horseNo))||byName.get(String(h.horseName))||''));
}
export function parseRuns(segment,targetDistance,trackName){
 const runs=[];
 // NAR DebaTableSmall actual format:
 // 船橋08.06 良 左 1200 ... 5/7 2人 ... 1159（2.3） 2-2-1 39.5
 // Ver.9.5 incorrectly expected "着順 YY.MM.DD". Ver.9.6 anchors on the real MM.DD block.
 const re=/([^\s]{0,8}?)(\d{2}\.\d{2})\s*(良|稍重|重|不良)\s*(?:ナ\s*)?(右|左|直|外|内)?\s*(\d{3,4})/g;
 const hits=[...segment.matchAll(re)].slice(0,5);
 for(let i=0;i<hits.length;i++){
   const m=hits[i],start=m.index,end=i+1<hits.length?hits[i+1].index:Math.min(segment.length,start+420);
   const chunk=segment.slice(start,end);
   const finishField=chunk.match(/(?:^|\s)(\d{1,2})\/(\d{1,2})\s+(\d{1,2})人/);
   if(!finishField)continue;
   const finish=Number(finishField[1]),fieldSize=Number(finishField[2]);
   if(!Number.isFinite(finish)||finish<1||finish>fieldSize||fieldSize<2)continue;
   const dist=Number(m[5])||null,popularity=Number(finishField[3])||null;
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
     finish,fieldSize,popularity,date:m[2],condition:m[3],direction:m[4]||'',venue,distance:dist,timeSec,last3f,corners,
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
 if(exact.length){
   const weights=[1,.82,.68].slice(0,exact.length),den=weights.reduce((a,b)=>a+b,0);
   const sec=exact.reduce((s,r,i)=>s+r.timeSec*weights[i],0)/den;
   return {time:secToRaceTime(sec),type:'実績',confidence:Math.round(clamp(72+exact.length*7,72,93))};
 }
 const near=(runs||[]).filter(r=>Number.isFinite(r.timeSec)&&r.distance&&targetDistance&&Math.abs(r.distance-targetDistance)<=300).slice(0,3);
 if(!near.length)return {time:'',type:'',confidence:null};
 const weights=[1,.78,.6].slice(0,near.length),den=weights.reduce((a,b)=>a+b,0);
 const adjusted=near.reduce((s,r,i)=>s+(r.timeSec*targetDistance/r.distance)*weights[i],0)/den;
 const avgGap=mean(near.map(r=>Math.abs(r.distance-targetDistance)))||0;
 return {time:secToRaceTime(adjusted),type:'補正',confidence:Math.round(clamp(66-avgGap/12+near.length*4,42,70))};
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
   const pt=predictTimeFromRuns(runs,targetDistance);
   return {...h,runs,recentIndex,fiveRaceAvgIndex:avg==null?null:Math.round(avg),distanceIndex:distScore==null?null:Math.round(distScore),courseIndex:courseScore==null?null:Math.round(courseScore),runningStyle,predictedTime:pt.time,predictedTimeType:pt.type,predictedTimeConfidence:pt.confidence,dataConfidence:Math.round(clamp(38+runs.length*8+sameD.length*4+sameC.length*2,38,92))};
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
      const meta=parseRaceMeta(dh||ch),detailHorses=parseRaceCard(dh),fallbackHorses=parseRaceCard(ch),cardHorses=detailHorses.length?detailHorses:fallbackHorses,odds=parseTanFuku(oh),track=TRACK_NAMES[Number(code)]||"";
      const enriched=enrichAbility(dh,cardHorses,meta.distance,track),cm=new Map(enriched.map(x=>[String(x.horseNo),x])),om=new Map(odds.map(x=>[String(x.horseNo),x]));
      const numbers=[...new Set([...enriched.map(x=>String(x.horseNo)),...odds.map(x=>String(x.horseNo))])].sort((a,b)=>Number(a)-Number(b));
      const merged=numbers.map(no=>{const c=cm.get(no)||{},o=om.get(no)||{};const cardName=String(c.horseName||'').trim(),oddsName=String(o.horseName||'').trim();const cardOk=plausibleHorseName(cardName),oddsOk=plausibleHorseName(oddsName);const horseName=cardOk?cardName:oddsOk?oddsName:`馬番${no}`;return {...c,horseNo:no,horseName,odds:o.odds??null,popularity:o.popularity??null,nameSource:cardOk?'出馬表':oddsOk?'オッズ表':'fallback'};});
      const abilityCount=merged.filter(x=>x.abilityScore!=null).length;
      const invalidHorseNames=merged.filter(x=>!plausibleHorseName(x.horseName)).length;
      return json({source:"NAR公式",version:VERSION,track,code,date,race,...meta,horses:merged,odds,quality:{horseNames:merged.length-invalidHorseNames,invalidHorseNames,total:merged.length,abilityData:abilityCount,abilityRate:merged.length?Math.round(100*abilityCount/merged.length):0,marketSeparated:true,parser:"DebaTableSmall-row-v9.8",predictedTime:merged.filter(x=>x.predictedTime).length,predictedTimeActual:merged.filter(x=>x.predictedTimeType==='実績').length,predictedTimeAdjusted:merged.filter(x=>x.predictedTimeType==='補正').length},acquiredAt:new Date().toISOString()});
    }catch(e){return json(errorPayload(e),e?.status===404?404:502)}
  }
  if(u.pathname==="/api/nar/odds"||u.pathname==="/api/nar/sync"){
    const code=u.searchParams.get("code"),date=u.searchParams.get("date"),race=u.searchParams.get("race");if(!code||!date||!race)return json({error:"code,date,race are required"},400);
    const q=`k_babaCode=${encodeURIComponent(code)}&k_raceDate=${encodeURIComponent(fmtDate(date))}&k_raceNo=${encodeURIComponent(race)}`;const urls={result:`https://www.keiba.go.jp/KeibaWeb/TodayRaceInfo/RaceMarkTable?${q}`,odds:`https://www.keiba.go.jp/KeibaWeb/TodayRaceInfo/OddsTanFuku?${q}`};
    try{
      if(u.pathname==="/api/nar/odds"){const oh=await fetchText(urls.odds),oo=parseTanFuku(oh);return json({source:"NAR公式",version:VERSION,track:TRACK_NAMES[Number(code)]||"",code,date,race,odds:oo,acquiredAt:new Date().toISOString()});}
      const [rh,oh]=await Promise.all([fetchText(urls.result),fetchText(urls.odds).catch(()=>"")]),rr=parseResult(rh),oo=parseTanFuku(oh),meta=parseRaceMeta(rh),om=new Map(oo.map(x=>[Number(x.horseNo),x]));
      rr.results=rr.results.map(x=>({...x,finalOdds:x.finalOdds??om.get(Number(x.horseNo))?.odds??null,popularity:x.popularity??om.get(Number(x.horseNo))?.popularity??null}));
      const total=rr.results.length,timeCount=rr.results.filter(x=>x.time).length,nameCount=rr.results.filter(x=>x.horseName).length,detailCount=rr.results.filter(x=>x.last3f!=null||x.cornerPositions||x.bodyWeight!=null).length;
      return json({source:"NAR公式",version:VERSION,track:TRACK_NAMES[Number(code)]||"",code,date,race,...rr,odds:oo,resultMeta:{weather:meta.weather,trackCondition:meta.trackCondition},quality:{resultRows:total,resultParseRate:rr.parserFallback?50:total?100:0,actualTimeRate:total?Math.round(100*timeCount/total):0,resultHorseNameRate:total?Math.round(100*nameCount/total):0,resultDetailRate:total?Math.round(100*detailCount/total):0,parser:rr.parserFallback?'legacy-fallback':'header-mapped-v1'},acquiredAt:new Date().toISOString(),pending:rr.finishOrder.length<3,resultStatus:rr.finishOrder.length<3?'unpublished':'available'});
    }catch(e){return json(errorPayload(e),e?.status===404?404:502)}
  }
  if(env?.ASSETS){const reqUrl=new URL(request.url);if(u.pathname==="/")reqUrl.pathname="/index.html";return env.ASSETS.fetch(new Request(reqUrl,request))}
  return new Response("Not Found",{status:404});
 }
};
