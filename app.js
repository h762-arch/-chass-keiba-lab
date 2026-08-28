(() => {
'use strict';
const APP_VERSION='9.4';
const $=id=>document.getElementById(id);
const KEY='chass_v90_races';
const LEGACY_KEY='chass_v80_races';
const CURRENT='chass_v90_current';
const LEGACY_CURRENT='chass_v80_current';
const ODDS_HISTORY='chass_v90_odds_history';
let oddsTimer=null;
let autoRaceSelectTimer=null;
const NAR_TRACKS={
  '盛岡':10,'水沢':11,'浦和':18,'船橋':19,'大井':20,'川崎':21,'笠松':22,'金沢':23,
  '名古屋':24,'園田':27,'姫路':28,'高知':31,'佐賀':32,'門別':36
};
const num=v=>{const n=parseFloat(v);return Number.isFinite(n)?n:null};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const cleanName=s=>String(s??'').replace(/\s+/g,'').trim();
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
const median=a=>{const b=a.filter(x=>x!=null).sort((x,y)=>x-y);if(!b.length)return null;const m=Math.floor(b.length/2);return b.length%2?b[m]:(b[m-1]+b[m])/2};
const arr=v=>Array.isArray(v)?v.map(num).filter(x=>x!=null):typeof v==='string'?v.split(/[,\s/→>]+/).map(num).filter(x=>x!=null):num(v)==null?[]:[num(v)];
const store={get(k,d){try{return JSON.parse(localStorage.getItem(k)||'')??d}catch{return d}},set(k,v){localStorage.setItem(k,JSON.stringify(v))}};

let state={race:{},horses:[],result:null,actualTimes:{},finalSnapshot:null,predictionSnapshot:null,marketSnapshot:null};

function setVersion(){
  document.title=`チャス競馬研究所 Ver.${APP_VERSION}`;
  const sp=document.querySelector('.topbar h1 span'); if(sp) sp.textContent=`Ver.${APP_VERSION}`;
}
function raceId(r={}){
 const d=String(r.raceDate||r.date||'').replaceAll('/','-');
 const t=String(r.track||'').trim();
 const n=String(r.raceNo||'').match(/\d+/)?.[0]||'';
 return d&&t&&n?`${d}|${t}|${n}`:'';
}
function oddsType(v){
 const s=String(v||'').trim();
 if(/予想|想定|参考|forecast|predicted/i.test(s))return '予想オッズ';
 if(/最終|確定|実オッズ|final|real|official/i.test(s))return '実オッズ';
 if(!s||/なし|未取得/.test(s))return 'オッズなし';
 return '種別不明';
}
function normalize(vals){
 const known=vals.filter(x=>x!=null); if(!known.length)return vals.map(()=>null);
 const lo=Math.min(...known),hi=Math.max(...known);if(lo===hi)return vals.map(v=>v==null?null:5);
 return vals.map(v=>v==null?null:clamp(1+8*(v-lo)/(hi-lo),1,9));
}
function derive(horses){
 const raw=horses.map(h=>{
   const recent=arr(h.recentIndex??h.近走指数);
   return {
     highest:num(h.timeIndex??h.maxTimeIndex??h.最高指数??h.最高),
     avg:num(h.fiveRaceAvgIndex??h.avg5Index??h['5走平均']??h.五走平均),
     distance:num(h.distanceIndex??h.距離指数),
     course:num(h.courseIndex??h.コース指数),
     recent,recentMean:mean(recent),
     trend:recent.length>=2?recent[recent.length-1]-recent[0]:null,
     kg:num(h.assignedWeight??h.carryWeight??h.weightKg??h.斤量??h.weight),
     confidence:num(h.dataConfidence??h.confidence)
   };
 });
 const fields=['highest','avg','distance','course','recentMean','trend'];
 const n={};fields.forEach(f=>n[f]=normalize(raw.map(x=>x[f])));
 const medKg=median(raw.map(x=>x.kg)); const kgScore=raw.map(x=>x.kg==null||medKg==null?null:clamp(5+(medKg-x.kg)*.45,2,8));
 const model=raw.map((x,i)=>{
   const parts=[[n.highest[i],.24],[n.avg[i],.28],[n.distance[i],.12],[n.course[i],.10],[n.recentMean[i],.18],[n.trend[i],.04],[kgScore[i],.02],[x.confidence==null?null:clamp(x.confidence/10,0,10),.02]].filter(([v])=>v!=null);
   const den=parts.reduce((s,[,w])=>s+w,0)||1;
   const score=parts.reduce((s,[v,w])=>s+v*w,0)/den;
   return {raw:x,norm:Object.fromEntries(fields.map(f=>[f,n[f][i]])),kgScore,score,completeness:den};
 });
 const max=Math.max(...model.map(x=>x.score)); const ex=model.map(x=>Math.exp((x.score-max)/1.2)); const sum=ex.reduce((a,b)=>a+b,0)||1;
 const win=ex.map(x=>100*x/sum); const b=win.map(w=>Math.pow(Math.max(w,.01),.72)); const bs=b.reduce((a,c)=>a+c,0)||1;
 const place=b.map(v=>300*v/bs).map(v=>clamp(v,1,88));
 return model.map((m,i)=>({...m,win:win[i],place:place[i],kgScore:kgScore[i]}));
}
function abilityMarks(horses){
 const sorted=[...horses].sort((a,b)=>b.win-a.win);
 sorted.forEach(h=>h.abilityMark='');
 sorted.slice(0,4).forEach((h,i)=>h.abilityMark=['◎','○','▲','△'][i]);
}
function applyValueFlags(horses){
 horses.forEach(h=>{h.valueMark='';h.warningMark='';});
 horses.forEach(h=>{
   if(h.odds==null||h.ev==null)return;
   if(h.popularity>=10&&h.place>=20&&h.ev>=125)h.valueMark='💎💎💎';
   else if(h.popularity>=5&&h.place>=22&&h.ev>=112)h.valueMark='💎';
   if(h.popularity>=1&&h.popularity<=3&&h.ev<75)h.warningMark=h.ev<55?'⚠️⚠️⚠️':h.ev<65?'⚠️⚠️':'⚠️';
 });
}
function transform(root){
 const r={...(root.meta||{}),...(root.race||{})};
 const src=Array.isArray(root.horses)?root.horses:[];
 if(src.length<2)throw new Error('horses配列が2頭未満です。');
 const dm=derive(src); const ot=oddsType(r.oddsType??root.oddsType); r.oddsType=ot; r.raceId=raceId(r);
 const horses=src.map((h,i)=>{
   const d=dm[i], win=num(h.aiWinRate??h.winRate??h.win??h.AI勝率)??d.win, place=num(h.aiPlaceRate??h.placeRate??h.place??h.AI複勝率)??d.place;
   return {
     horseNo:h.horseNo??h.horseNumber??h.馬番??i+1,
     horseName:h.horseName??h.horse??h.name??h.馬名??'',
     sourceMark:String(h.sourceMark??h.mark??''),
     popularity:num(h.popularity??h.pop??h.人気),
     odds:num(h.realOdds??h.finalOdds??h.odds??h.単勝オッズ),
     runningStyle:h.runningStyle??h.style??h.脚質??'不明',
     predictedTime:h.predictedTime??h.time??h.予想走破タイム??'',
     actualTime:h.actualTime??'',
     reason:h.reason??h.根拠??'',
     dataMode:h.dataMode??r.dataMode??(r.autoGenerated?'NAR自動':'指数データ'),
     marketScore:num(h.marketScore),
     dataConfidence:num(h.dataConfidence??h.confidence)??Math.round(45+d.completeness*45),
     raw:{highest:d.raw.highest,avg5:d.raw.avg,distance:d.raw.distance,course:d.raw.course,recent:d.raw.recent,kg:d.raw.kg},
     scores:{timeIndex:d.score,distanceFit:d.norm.distance,courseFit:d.norm.course,weight:d.kgScore},
     win,place,abilityMark:'',valueMark:'',warningMark:'',finalMark:'',overall:0,ev:null,fair:win>0?100/win:null
   };
 });
 const s=horses.map(h=>h.scores.timeIndex??null), n=normalize(s);
 const hasAbilityData=horses.some(h=>h.raw.highest!=null||h.raw.avg5!=null||h.raw.distance!=null||h.raw.course!=null||h.raw.recent.length);
 horses.forEach((h,i)=>{
   if(r.autoGenerated && !hasAbilityData){
     // Ver.9.4: NAR自動時に全馬同点へ潰れないよう、
     // 「能力指数」ではなく市場情報ベースの暫定総合として明確に分離。
     const ms=h.marketScore!=null?h.marketScore:clamp((h.win||0)*1.25+(h.place||0)*.35,20,95);
     h.overall=Math.round(clamp(ms+(h.dataConfidence-45)*.08,20,96));
   }else{
     const ability=n[i]!=null?n[i]:5;
     h.overall=Math.round(clamp(40+ability*6+(h.dataConfidence-50)*.12,0,100));
   }
 });
 abilityMarks(horses);
 if(ot==='実オッズ'){
   horses.forEach(h=>{if(h.odds!=null){h.ev=h.odds*h.win;h.fair=h.win>0?100/h.win:null;}});
   applyValueFlags(horses);
 }
 return {race:r,horses,result:null,actualTimes:{},finalSnapshot:null,predictionSnapshot:null,marketSnapshot:null};
}
function normalizeCategory(v){
 const s=String(v||'').trim();
 if(s==='地方'||s==='地方競馬')return '地方競馬';
 if(s==='中央'||s==='中央競馬')return '中央競馬';
 return '地方競馬';
}
function fillRace(r){
 $('category').value=normalizeCategory(r.category);$('raceDate').value=(r.raceDate||r.date||'').replaceAll('/','-');$('track').value=r.track||'';$('raceNo').value=r.raceNo||'';
 if($('autoRaceDate'))$('autoRaceDate').value=$('raceDate').value;
 if($('autoTrack')&&NAR_TRACKS[r.track])$('autoTrack').value=r.track;
 if($('autoRaceNo')&&r.raceNo)$('autoRaceNo').value=String(r.raceNo);$('distance').value=r.distance||'';$('trackCondition').value=r.trackCondition||'不明';$('chaos').value=r.chaos??50;$('pace').value=r.pace||'標準';
}
function raceFromForm(){
 return {...state.race,category:$('category').value,raceDate:$('raceDate').value,track:$('track').value,raceNo:Number($('raceNo').value)||'',distance:Number($('distance').value)||'',trackCondition:$('trackCondition').value,chaos:Number($('chaos').value)||50,pace:$('pace').value||'標準'};
}
function finalScore(h){
 return (h.win||0)*.45+(h.place||0)*.15+(h.overall||0)*.25+((h.ev??100)-100)*.08+(h.dataConfidence||0)*.07;
}
function rankFinalFor(horses){return [...horses].sort((a,b)=>finalScore(b)-finalScore(a))}
function rankFinal(){return rankFinalFor(state.horses)}
function makeSnapshot(){
 const top3=rankFinal().slice(0,3).map((h,i)=>({horseNo:Number(h.horseNo),horseName:h.horseName,mark:['◎','○','▲'][i],score:finalScore(h),win:h.win,place:h.place,overall:h.overall,ev:h.ev,odds:h.odds,popularity:h.popularity}));
 state.finalSnapshot={createdAt:new Date().toISOString(),marketType:state.race.oddsType,top3};
 const marks=['◎','○','▲']; state.horses.forEach(h=>h.finalMark='');
 top3.forEach((x,i)=>{const h=state.horses.find(z=>Number(z.horseNo)===Number(x.horseNo));if(h)h.finalMark=marks[i]});
 if(!state.predictionSnapshot){
   state.predictionSnapshot={createdAt:new Date().toISOString(),horses:state.horses.map(h=>({horseNo:Number(h.horseNo),horseName:h.horseName,win:h.win,place:h.place,overall:h.overall,predictedTime:h.predictedTime,abilityMark:h.abilityMark,sourceMark:h.sourceMark||'',dataConfidence:h.dataConfidence}))};
 }
}
function render(){
 setVersion(); state.race=raceFromForm(); const r=state.race,h=state.horses; const rid=raceId(r);
 $('raceTitle').textContent=r.track&&r.raceNo?`${r.track} ${r.raceNo}R`:'レース情報未入力';
 $('raceMeta').textContent=[r.raceDate?String(r.raceDate).slice(5).replace('-','/'):'',r.distance?`${r.distance}m`:'',r.raceName||''].filter(Boolean).join('｜')||'予想データファイルを読み込むと自動表示します。';
 $('chaosBadge').textContent=`波乱度 ${r.chaos??'—'}%`;$('paceBadge').textContent=`展開 ${r.pace||'—'}`;$('biasText').textContent=`馬場：${r.bias||r.trackCondition||'—'}`;
 const prob=h.filter(x=>x.win!=null&&x.place!=null).length,time=h.filter(x=>x.predictedTime).length,market=h.filter(x=>x.odds!=null).length;
 const names=new Set(h.map(x=>cleanName(x.horseName))); const bad=h.some(x=>!x.horseName)||names.size!==h.length;
 $('integrityGrid').innerHTML=[['レースID',rid||'—'],['AI確率',`${prob}/${h.length}頭`],['予想TIME',`${time}/${h.length}頭`],['市場',`${market}/${h.length}頭`],['データ状態',bad?'要確認':'正常'],['生成方式',r.autoGenerated?'NAR自動':'JSON'],['評価モード',r.dataMode||'—']].map(([a,b])=>`<div><span>${a}</span><strong>${esc(b)}</strong></div>`).join('');
 renderFinal();renderQuick();renderHorses();
}
function renderFinal(){
 const h=state.horses;if(!h.length){$('finalBody').innerHTML='予想データを読み込むと自動表示します。';return}
 const picks=rankFinal().slice(0,3), marks=['◎','○','▲']; const diamond=h.filter(x=>x.valueMark).sort((a,b)=>(b.ev||0)-(a.ev||0))[0]; const warn=h.filter(x=>x.warningMark).sort((a,b)=>(a.ev||999)-(b.ev||999))[0];
 $('marketStatus').textContent=state.race.oddsType==='実オッズ'?'市場反映済':state.race.oddsType||'市場待ち';
 $('finalBody').innerHTML=`<div class="final-grid">${picks.map((x,i)=>`<div class="final-pick"><strong>${marks[i]} ${x.horseNo}番 ${esc(x.horseName)}</strong><small>勝 ${x.win.toFixed(1)}% ｜ 複 ${x.place.toFixed(1)}%<br>総合 ${x.overall}/100 ｜ 期待 ${x.ev==null?'市場待ち':x.ev.toFixed(0)+'%'} ｜ AIフェア ${x.fair?x.fair.toFixed(1)+'倍':'—'}</small></div>`).join('')}</div><div class="flags"><div class="flag-box diamond">${diamond?`${diamond.valueMark} 穴馬：${diamond.horseNo}番 ${esc(diamond.horseName)} ｜ 期待 ${diamond.ev.toFixed(0)}%`:'💎 穴馬：現時点で強い市場乖離なし'}</div><div class="flag-box warning">${warn?`${warn.warningMark} 人気馬注意：${warn.horseNo}番 ${esc(warn.horseName)} ｜ 期待 ${warn.ev.toFixed(0)}%`:'⚠️ 人気馬リスク：強い該当なし'}</div></div>`;
}
function displayMark(h){return [h.finalMark||h.abilityMark,h.valueMark,h.warningMark].filter(Boolean).join(' ')}
function renderQuick(){
 const h=state.horses;if(!h.length){$('quickList').innerHTML='馬データを入力すると一覧表示します。';return}
 $('quickList').innerHTML=[...h].sort((a,b)=>b.overall-a.overall).map(x=>`<div class="quick-row"><div class="quick-no">${x.horseNo}</div><div class="quick-name">${esc(displayMark(x))} ${esc(x.horseName)}</div><div class="quick-stat"><span>勝</span><strong>${x.win.toFixed(1)}%</strong></div><div class="quick-stat"><span>複</span><strong>${x.place.toFixed(1)}%</strong></div><div class="quick-stat"><span>TIME</span><strong>${esc(x.predictedTime||'—')}</strong></div><div class="quick-stat"><span>総合</span><strong>${x.overall}</strong></div></div>`).join('');
}
function renderHorses(){
 const list=$('horseList');list.innerHTML=''; const tpl=$('horseTpl');
 state.horses.forEach(x=>{
   const n=tpl.content.cloneNode(true);n.querySelector('.horse-no').textContent=x.horseNo;n.querySelector('.horse-mark-name').textContent=`${displayMark(x)} ${x.horseName}`.trim();n.querySelector('.horse-sub').textContent=[x.runningStyle,x.popularity?`${x.popularity}人気`:'',x.odds?`${x.odds}倍`:''].filter(Boolean).join('｜');n.querySelector('.overall-pill').textContent=`総合 ${x.overall}`;n.querySelector('.m-win').textContent=x.win.toFixed(1)+'%';n.querySelector('.m-place').textContent=x.place.toFixed(1)+'%';n.querySelector('.m-time').textContent=x.predictedTime||'未推定';n.querySelector('.m-overall').textContent=x.overall; const raw=x.raw;n.querySelector('.facts').innerHTML=`最高指数 ${raw.highest??'—'} / 5走平均 ${raw.avg5??'—'} / 距離 ${raw.distance??'—'} / コース ${raw.course??'—'} / 近走 ${raw.recent.length?raw.recent.join('→'):'—'} / 斤量 ${raw.kg??'—'}kg`;n.querySelector('.logic').innerHTML=`評価モード ${esc(x.dataMode||'—')} / 指数スコア ${x.scores.timeIndex?.toFixed(1)??'—'} / 距離適性 ${x.scores.distanceFit?.toFixed(1)??'—'} / コース適性 ${x.scores.courseFit?.toFixed(1)??'—'} / 斤量補正 ${x.scores.weight?.toFixed(1)??'—'} / 信頼度 ${x.dataConfidence}%${x.sourceMark?` / 元印 ${esc(x.sourceMark)}`:''}`;n.querySelector('.reason').textContent=x.reason||'根拠データなし';list.appendChild(n);
 });
}
function mergeExisting(next, existing){
 if(!existing)return next;
 next.result=existing.result||next.result;
 next.actualTimes=existing.actualTimes||next.actualTimes||{};
 next.finalSnapshot=existing.finalSnapshot||next.finalSnapshot;
 next.predictionSnapshot=existing.predictionSnapshot||next.predictionSnapshot;
 next.marketSnapshot=existing.marketSnapshot||next.marketSnapshot;
 if(existing.race?.oddsType==='実オッズ'){
   next.race.oddsType='実オッズ'; next.race.oddsUpdatedAt=existing.race.oddsUpdatedAt;
   const oldMap=new Map((existing.horses||[]).map(h=>[String(h.horseNo),h]));
   next.horses.forEach(h=>{const o=oldMap.get(String(h.horseNo));if(o?.odds!=null){h.odds=o.odds;h.popularity=o.popularity;h.ev=o.ev;h.fair=o.fair;h.valueMark=o.valueMark||'';h.warningMark=o.warningMark||'';}});
 }
 return next;
}

function initAutoRaceControls(){
 const td=$('autoTrack'),rn=$('autoRaceNo'),dd=$('autoRaceDate');
 if(td){
   td.innerHTML=Object.keys(NAR_TRACKS).map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join('');
   if($('track').value && NAR_TRACKS[$('track').value])td.value=$('track').value;
 }
 if(rn)rn.innerHTML=Array.from({length:12},(_,i)=>`<option value="${i+1}">${i+1}R</option>`).join('');
 if(dd&&!dd.value){
   const now=new Date(),local=new Date(now.getTime()-now.getTimezoneOffset()*60000);
   dd.value=local.toISOString().slice(0,10);
 }
}
function provisionalModelFromOfficial(root){
 const horses=Array.isArray(root.horses)?root.horses:[];
 const withOdds=horses.filter(h=>num(h.odds)!=null&&num(h.odds)>0);
 const n=horses.length||1;
 const probs=new Map();

 if(withOdds.length>=2){
   const raw=withOdds.map(h=>({no:String(h.horseNo),p:1/num(h.odds)}));
   const sum=raw.reduce((s,x)=>s+x.p,0)||1;
   raw.forEach(x=>probs.set(x.no,x.p/sum));
 }

 const knownP=[...probs.values()];
 const pmin=knownP.length?Math.min(...knownP):0;
 const pmax=knownP.length?Math.max(...knownP):0;
 const medKg=median(horses.map(h=>num(h.weight)).filter(x=>x!=null));

 horses.forEach(h=>{
   const mp=probs.get(String(h.horseNo));
   const neutral=1/n;
   // Market is used as a provisional prior, not presented as independent ability evidence.
   const blend=mp!=null?(mp*.84+neutral*.16):neutral;
   h.aiWinRate=clamp(100*blend,0.5,72);

   const marketNorm=mp==null||pmax===pmin?50:clamp(20+75*(mp-pmin)/(pmax-pmin),20,95);
   const kg=num(h.weight);
   const kgAdj=(kg!=null&&medKg!=null)?clamp((medKg-kg)*1.2,-5,5):0;
   h.marketScore=clamp(marketNorm+kgAdj,20,96);
   h.dataMode='NAR自動・市場暫定';
   h.dataConfidence=mp!=null?48:32;
   h.reason=mp!=null
     ?`NAR公式出馬表と単勝市場を同時取得。市場確率を初期事前分布として使用し、斤量を小さく補正。タイム指数・近走ラップ等は未反映のため「市場暫定」評価です。`
     :`NAR公式出馬表を取得。単勝市場が未取得のため均等事前分布から暫定評価。タイム指数・近走ラップ等は未反映です。`;
 });

 const weights=horses.map(h=>Math.pow(Math.max(num(h.aiWinRate)||0.5,.01),.72));
 const ws=weights.reduce((a,b)=>a+b,0)||1;
 horses.forEach((h,i)=>h.aiPlaceRate=clamp(300*weights[i]/ws,2,88));

 root.race={
   ...root.race,
   dataSource:'NAR公式自動生成',
   autoGenerated:true,
   dataMode:'NAR自動・市場暫定',
   autoModel:'official card + market prior',
   predictedTimePolicy:'未推定（根拠データ不足時は生成しない）'
 };
 return root;
}
async function loadAutoRace(){
 const date=$('autoRaceDate')?.value,track=$('autoTrack')?.value,raceNo=Number($('autoRaceNo')?.value);
 const code=narCode(track);
 if(!date||!code||!raceNo){$('autoRaceStatus').textContent='日付・競馬場・レースを確認してください。';return}
 $('autoRaceBadge').textContent='取得中';
 $('autoRaceStatus').textContent='NAR公式の出馬表・取得可能なオッズを確認しています…';
 try{
   const u=`/api/nar/race?code=${code}&date=${encodeURIComponent(date)}&race=${raceNo}`;
   const res=await fetch(u,{cache:'no-store'}),d=await res.json();
   if(!res.ok)throw new Error(d.error||'取得失敗');
   if(!Array.isArray(d.horses)||d.horses.length<2)throw new Error('出走馬データを取得できませんでした');
   const root=provisionalModelFromOfficial({
     race:{
       category:'地方競馬',raceDate:date,track:d.track||track,raceNo,
       raceName:d.raceName||'',distance:d.distance||'',surface:d.surface||'ダート',
       weather:d.weather||'',trackCondition:d.trackCondition||'不明',
       chaos:d.chaos??50,pace:d.pace||'標準',bias:d.bias||'',
       oddsType:(d.odds||[]).length?'実オッズ':'オッズなし',
       dataNote:'NAR公式出馬表からVer.9.3が内部生成'
     },
     horses:d.horses.map(h=>({
       horseNo:h.horseNo,horseName:h.horseName||`馬番${h.horseNo}`,
       popularity:h.popularity??null,odds:h.odds??null,
       runningStyle:h.runningStyle||'不明',weight:h.weight??null,
       jockey:h.jockey||'',trainer:h.trainer||'',sexAge:h.sexAge||'',
       dataMode:'NAR自動・市場暫定',dataConfidence:h.dataConfidence??null
     }))
   });
   const rid=raceId(root.race),db=store.get(KEY,{}),old=db[rid];
   const next=transform(root);
   if(old){
     next.result=old.result||null;next.actualTimes=old.actualTimes||{};
     next.finalSnapshot=old.finalSnapshot||null;next.predictionSnapshot=old.predictionSnapshot||null;
   }
   state=next;fillRace(state.race);
   let marketCount=0;
   if(Array.isArray(d.odds)&&d.odds.length){
     marketCount=applyMarketOdds(d.odds,d.acquiredAt||new Date().toISOString());
   }
   render();persist(old?.validated||false);
   $('autoRaceBadge').textContent=`${state.horses.length}頭`;
   $('autoRaceStatus').textContent=`NAR公式から${state.horses.length}頭を自動生成${marketCount?` / 現在オッズ ${marketCount}頭も同時反映`:''}。手動JSONなしで市場暫定予想を開始しました。TIMEは根拠データ不足時に捏造せず未推定とします。`;
   $('importStatus').textContent=`✓ Ver.${APP_VERSION} 自動生成：${state.horses.length}頭 / データ源 NAR公式${marketCount?` / 現在オッズ ${marketCount}頭反映`:''}`;
   if(marketCount){
     $('liveOddsBadge').textContent=`${marketCount}頭反映`;
     const t=new Date(state.race.oddsUpdatedAt||d.acquiredAt||Date.now()).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
     $('liveOddsStatus').textContent=`NAR公式 現在オッズ ${marketCount}頭をレースデータと同時取得｜更新 ${t}｜人気・期待回収率・穴馬/危険馬まで再計算済み`;
   }else{
     $('liveOddsBadge').textContent='未取得';
     $('liveOddsStatus').textContent='出馬表は取得済み。現在オッズは発売前・未掲載などで取得できませんでした。';
   }
 }catch(e){
   $('autoRaceBadge').textContent='取得失敗';
   $('autoRaceStatus').textContent='自動生成失敗：'+e.message;
 }
}

async function importFile(f){
 const text=(await f.text()).replace(/^\uFEFF/,'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');let root;try{root=JSON.parse(text)}catch(e){throw new Error('JSON構文エラー: '+e.message)}
 let next=transform(root);fillRace(next.race);const rid=raceId(next.race);const db=store.get(KEY,{});const legacy=store.get(LEGACY_KEY,{});next=mergeExisting(next,db[rid]||legacy[rid]);state=next;render(); if(!state.finalSnapshot)makeSnapshot();persist(existingValidated(rid));$('importStatus').textContent=`✓ Ver.${APP_VERSION}：${state.horses.length}頭読込 / AI勝率・複勝率計算済 / TIME ${state.horses.filter(x=>x.predictedTime).length}頭 / ${state.race.oddsType}`;
}
function existingValidated(rid){
 const db=store.get(KEY,{}),legacy=store.get(LEGACY_KEY,{});
 return !!(db[rid]?.validated||legacy[rid]?.validated||state.result?.finishOrder?.length>=3);
}
function persist(validated=false){
 state.race=raceFromForm();const rid=raceId(state.race);if(!rid)return;
 const db=store.get(KEY,{}),old=db[rid];
 if(!state.finalSnapshot&&state.horses.length)makeSnapshot();
 db[rid]={...old,...state,updatedAt:new Date().toISOString(),validated:validated||old?.validated||false};
 store.set(KEY,db);store.set(CURRENT,rid);
}
function narCode(track){return NAR_TRACKS[track]||null}
function applyMarketOdds(items, acquiredAt){
 if(!Array.isArray(items)||!items.length)return 0;
 const valid=items.map(x=>({horseNo:String(x.horseNo),odds:num(x.odds),popularity:num(x.popularity)})).filter(x=>x.horseNo&&x.odds!=null);
 const pop=[...valid].sort((a,b)=>a.odds-b.odds),popMap=new Map(pop.map((x,i)=>[x.horseNo,x.popularity??i+1])),map=new Map(valid.map(x=>[x.horseNo,x.odds]));
 state.horses.forEach(h=>{const k=String(h.horseNo),o=map.get(k);if(o!=null){h.odds=o;h.popularity=popMap.get(k)||null;h.ev=o*h.win;h.fair=h.win>0?100/h.win:null;}});
 abilityMarks(state.horses); applyValueFlags(state.horses); state.race.oddsType='実オッズ'; state.race.oddsUpdatedAt=acquiredAt||new Date().toISOString();
 state.marketSnapshot={createdAt:state.race.oddsUpdatedAt,horses:state.horses.map(h=>({horseNo:Number(h.horseNo),odds:h.odds,popularity:h.popularity,ev:h.ev,valueMark:h.valueMark,warningMark:h.warningMark}))};
 makeSnapshot();
 const rid=raceId(raceFromForm()); if(rid){const hist=store.get(ODDS_HISTORY,{});(hist[rid]??=[]).push({at:state.race.oddsUpdatedAt,odds:valid});hist[rid]=hist[rid].slice(-120);store.set(ODDS_HISTORY,hist)}
 return valid.length;
}
async function syncLiveOdds(silent=false){
 const r=raceFromForm(),code=narCode(r.track);if(!code){$('liveOddsStatus').textContent='現在オッズ自動取得：この競馬場は未対応です。';return}
 if(!r.raceDate||!r.raceNo){$('liveOddsStatus').textContent='日付・競馬場・レース番号を確認してください。';return}
 if(!silent)$('liveOddsStatus').textContent='NAR公式の現在オッズを確認中…';
 try{const u=`/api/nar/odds?code=${code}&date=${encodeURIComponent(r.raceDate)}&race=${r.raceNo}`;const res=await fetch(u,{cache:'no-store'});const d=await res.json();if(!res.ok)throw new Error(d.error||'取得失敗');const count=applyMarketOdds(d.odds,d.acquiredAt);if(!count)throw new Error('現在オッズを確認できません（発売前・未掲載の可能性）');render();persist(existingValidated(raceId(r)));const t=new Date(state.race.oddsUpdatedAt).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit',second:'2-digit'});$('liveOddsBadge').textContent=`${count}頭反映`;$('liveOddsStatus').textContent=`NAR公式 現在オッズ ${count}頭反映｜更新 ${t}｜人気・期待回収率・穴馬/危険馬を再計算済み`;}catch(e){$('liveOddsBadge').textContent='取得失敗';$('liveOddsStatus').textContent='取得失敗：'+e.message}
}
function setAutoOdds(on){if(oddsTimer){clearInterval(oddsTimer);oddsTimer=null}if(on){syncLiveOdds();oddsTimer=setInterval(()=>syncLiveOdds(true),60000)}}

function saveFetchedResult(finishOrder,{silent=true,source='NAR公式自動保存'}={}){
 const f=(finishOrder||[]).map(num).filter(x=>x!=null).slice(0,3);
 if(f.length<3)return false;
 $('finish1').value=f[0];$('finish2').value=f[1];$('finish3').value=f[2];
 if(!state.finalSnapshot)makeSnapshot();
 const tmp={...state,result:{finishOrder:f,actualTimes:{...state.actualTimes}}};
 const autoReasons=failureReasonsForRace(tmp).map(x=>x.label).join(' / ');
 state.result={
   finishOrder:f,
   memo:$('memo').value,
   autoDiagnosis:autoReasons,
   at:new Date().toISOString(),
   actualTimes:{...state.actualTimes},
   source,
   autoSaved:true
 };
 persist(true);
 renderDashboard();
 if(!silent)alert('検証結果を保存しました。');
 return true;
}

async function syncNar(){
 const r=raceFromForm(),code=narCode(r.track);if(!code){$('narStatus').textContent='NAR自動取得：この競馬場は未対応です。';return}
 if(!r.raceDate||!r.raceNo){$('narStatus').textContent='日付・競馬場・レース番号を確認してください。';return}
 const u=`/api/nar/sync?code=${code}&date=${encodeURIComponent(r.raceDate)}&race=${r.raceNo}`;
 $('narStatus').textContent='NAR公式から結果・最終オッズ・実走TIMEを取得中…';
 try{
   const res=await fetch(u,{cache:'no-store'}),d=await res.json();
   if(!res.ok)throw new Error(d.error||'取得失敗');

   if(d.actualTimes&&typeof d.actualTimes==='object'){
     state.actualTimes={...state.actualTimes,...d.actualTimes};
     state.horses.forEach(h=>{
       const t=state.actualTimes[String(h.horseNo)];
       if(t)h.actualTime=t;
     });
   }
   if(Array.isArray(d.odds)&&d.odds.length){
     applyMarketOdds(d.odds,d.acquiredAt||new Date().toISOString());
   }

   const complete=Array.isArray(d.finishOrder)&&d.finishOrder.length>=3;
   if(complete){
     // 取得時点の結果・最終オッズ・実走TIMEを一体で保存する。
     // 後から手動修正した場合は既存の保存ボタンで上書きできる。
     saveFetchedResult(d.finishOrder,{silent:true,source:'NAR公式取得時に自動保存'});
   }else{
     persist(existingValidated(raceId(r)));
   }

   render();
   const base=`NAR公式反映：着順 ${d.finishOrder?.join('-')||'未確定'} / オッズ ${d.odds?.length||0}頭 / 実走TIME ${Object.keys(d.actualTimes||{}).length}頭`;
   $('narStatus').textContent=complete
     ? `${base} / 検証結果まで自動保存済み`
     : `${base} / 結果未確定のため保存待ち`;
 }catch(e){
   $('narStatus').textContent='取得失敗：'+e.message;
 }
}
function saveValidation(){
 const f=[num($('finish1').value),num($('finish2').value),num($('finish3').value)].filter(x=>x!=null);
 if(f.length<3){alert('1〜3着を入力してください');return}
 saveFetchedResult(f,{silent:false,source:'手動修正保存'});
}
function getAllRaces(){
 const legacy=store.get(LEGACY_KEY,{}),now=store.get(KEY,{});
 const merged={...legacy,...now}; return Object.values(merged).filter(x=>x?.validated&&x.result?.finishOrder?.length>=3);
}
function horsePosition(r,h){const no=Number(h?.horseNo);const i=(r.result?.finishOrder||[]).map(Number).indexOf(no);return i>=0?i+1:null}

function timeToSec(v){
 const s=String(v||'').trim();
 const m=s.match(/^(\d+):([0-5]\d(?:\.\d+)?)$/);
 if(!m)return null;
 return Number(m[1])*60+Number(m[2]);
}
function pct(n,d){return d?`${(n/d*100).toFixed(1)}%`:'—'}
function getHorseByNo(r,no){return (r.horses||[]).find(h=>Number(h.horseNo)===Number(no))||null}
function top3Snapshot(r){
 const snap=r.finalSnapshot?.top3;
 if(Array.isArray(snap)&&snap.length)return snap.slice(0,3);
 return rankFinalFor(r.horses||[]).slice(0,3).map((h,i)=>({horseNo:Number(h.horseNo),mark:['◎','○','▲'][i]}));
}
function aggregateAdvanced(races){
 const adv={
   races:races.length,
   top3Any:0,top3Perfect:0,top3Captured:0,
   diamondN:0,diamondPlace:0,diamondWin:0,diamondPop:[],diamondOdds:[],
   warningN:0,warningOut:0,
   ev100N:0,ev100Win:0,ev100Place:0,
   winMae:[],placeMae:[],winBrier:[],placeBrier:[],
   timeAbs:[],finalRankAbs:[],
   byDistance:{},byPopularity:{},byEvBand:{}
 };
 const band=(o)=>{
   if(o==null)return '不明';
   if(o<=3)return '1-3人気';
   if(o<=6)return '4-6人気';
   if(o<=9)return '7-9人気';
   return '10人気以下';
 };
 const evBand=(e)=>{
   if(e==null)return '未取得';
   if(e<100)return '<100%';
   if(e<150)return '100-149%';
   if(e<250)return '150-249%';
   return '250%以上';
 };
 const pushGroup=(obj,key,hit,win)=>{
   const g=(obj[key]??={n:0,place:0,win:0});g.n++;if(hit)g.place++;if(win)g.win++;
 };
 for(const r of races){
   const order=(r.result?.finishOrder||[]).map(Number);
   const snap=top3Snapshot(r);
   const captured=snap.filter(x=>order.includes(Number(x.horseNo))).length;
   if(captured>0)adv.top3Any++;
   if(captured===3)adv.top3Perfect++;
   adv.top3Captured+=captured;

   // FINAL rank vs actual rank, for top3 only
   snap.forEach((x,i)=>{
     const pos=order.indexOf(Number(x.horseNo));
     if(pos>=0)adv.finalRankAbs.push(Math.abs((i+1)-(pos+1)));
   });

   for(const h of (r.horses||[])){
     const no=Number(h.horseNo), pos=order.indexOf(no), placed=pos>=0, won=pos===0;
     const vm=h.valueMark|| (h.mark?.includes?.('💎')?h.mark:'');
     const wm=h.warningMark||h.warning||'';
     if(vm){
       adv.diamondN++; if(placed)adv.diamondPlace++; if(won)adv.diamondWin++;
       if(h.popularity!=null)adv.diamondPop.push(Number(h.popularity));
       if(h.odds!=null)adv.diamondOdds.push(Number(h.odds));
     }
     if(wm){adv.warningN++; if(!placed)adv.warningOut++;}
     if(h.ev!=null&&h.ev>=100){adv.ev100N++; if(won)adv.ev100Win++; if(placed)adv.ev100Place++;}

     if(h.win!=null){
       const y=won?1:0, p=Number(h.win)/100;
       adv.winMae.push(Math.abs(p-y)*100);adv.winBrier.push((p-y)**2);
     }
     if(h.place!=null){
       const y=placed?1:0, p=Number(h.place)/100;
       adv.placeMae.push(Math.abs(p-y)*100);adv.placeBrier.push((p-y)**2);
     }
     const pred=timeToSec(h.predictedTime), actual=timeToSec(h.actualTime||r.actualTimes?.[String(h.horseNo)]||r.result?.actualTimes?.[String(h.horseNo)]);
     if(pred!=null&&actual!=null)adv.timeAbs.push(Math.abs(pred-actual));

     const dist=String(r.race?.distance||'不明');
     pushGroup(adv.byDistance,dist,placed,won);
     pushGroup(adv.byPopularity,band(h.popularity),placed,won);
     pushGroup(adv.byEvBand,evBand(h.ev),placed,won);
   }
 }
 return adv;
}
function renderGroupTable(title,obj){
 const rows=Object.entries(obj).map(([k,g])=>`<div class="dash-row"><strong>${esc(k)}</strong><span>対象 ${g.n}</span><span>勝 ${pct(g.win,g.n)}</span><span>複 ${pct(g.place,g.n)}</span><span></span></div>`).join('');
 return `<div class="dash-section"><h3>${title}</h3>${rows||'<p class="muted">データなし</p>'}</div>`;
}


function failureReasonsForRace(r){
 const order=(r.result?.finishOrder||[]).map(Number);
 const snap=top3Snapshot(r);
 const reasons=[];
 const topPick=snap[0] ? getHorseByNo(r,snap[0].horseNo) : null;
 const winner=getHorseByNo(r,order[0]);

 if(topPick && Number(topPick.horseNo)!==order[0]){
   if(topPick.popularity!=null && topPick.popularity<=3 && topPick.ev!=null && topPick.ev<90){
     reasons.push({code:'MARKET_OVER',label:'人気・市場過大評価',detail:`FINAL◎ ${topPick.horseNo}番は${topPick.popularity}人気・期待${Math.round(topPick.ev)}%`});
   }
   if(topPick.valueMark){
     reasons.push({code:'VALUE_OVER',label:'穴馬/期待値過大評価',detail:`FINAL◎に${topPick.valueMark}が重なり市場妙味を強く見過ぎた可能性`});
   }
   if(topPick.win!=null && topPick.win>=35 && !order.includes(Number(topPick.horseNo))){
     reasons.push({code:'PROB_OVER',label:'AI勝率過大評価',detail:`AI勝率${topPick.win.toFixed(1)}%に対して3着外`});
   }
   const pt=timeToSec(topPick.predictedTime);
   const at=timeToSec(topPick.actualTime||r.actualTimes?.[String(topPick.horseNo)]||r.result?.actualTimes?.[String(topPick.horseNo)]);
   if(pt!=null && at!=null && Math.abs(pt-at)>=1.5){
     reasons.push({code:'TIME_ERROR',label:'予想TIME誤差',detail:`FINAL◎のTIME誤差 ${Math.abs(pt-at).toFixed(2)}秒`});
   }
 }
 if(winner){
   const winnerSnapRank=snap.findIndex(x=>Number(x.horseNo)===Number(winner.horseNo));
   if(winnerSnapRank<0){
     if(winner.overall!=null && topPick?.overall!=null && winner.overall+10 < topPick.overall){
       reasons.push({code:'ABILITY_UNDER',label:'勝ち馬能力過小評価',detail:`勝ち馬${winner.horseNo}番の総合${winner.overall}を上位評価できず`});
     }
     if(winner.popularity!=null && winner.popularity>=5){
       reasons.push({code:'LONGSHOT_MISS',label:'穴馬取りこぼし',detail:`勝ち馬${winner.horseNo}番は${winner.popularity}人気`});
     }
   }
 }
 const pace=String(r.race?.pace||'');
 const bias=String(r.race?.bias||r.race?.trackCondition||'');
 if(pace && /速|遅|ハイ|スロー/.test(pace)){
   reasons.push({code:'PACE_CHECK',label:'展開検証候補',detail:`事前展開「${pace}」と実際のレース内容を要確認`});
 }
 if(bias && bias!=='不明' && bias!=='—'){
   reasons.push({code:'BIAS_CHECK',label:'馬場バイアス検証候補',detail:`事前馬場評価「${bias}」を結果と照合`});
 }
 if(!reasons.length){
   reasons.push({code:'NO_CLEAR',label:'明確な単一原因なし',detail:'現保存データだけでは主要因を特定できません。検証メモやラップ追加で精度向上。'});
 }
 return reasons.slice(0,4);
}
function aggregateFailureReasons(races){
 const map={};
 races.forEach(r=>failureReasonsForRace(r).forEach(x=>{
   const g=(map[x.code]??={label:x.label,count:0});g.count++;
 }));
 return Object.values(map).sort((a,b)=>b.count-a.count);
}
function renderFailureAnalysis(races){
 const agg=aggregateFailureReasons(races);
 const summary='<div class="dash-section"><h3>失敗原因ランキング</h3>'+
   (agg.length?agg.map((x,i)=>`<div class="dash-row"><strong>${i+1}. ${esc(x.label)}</strong><span>${x.count}R</span><span>${pct(x.count,races.length)}</span><span></span><span></span></div>`).join(''):'<p class="muted">データなし</p>')+
   '</div>';
 const detail='<div class="dash-section"><h3>レース別 自動診断</h3>'+
   races.slice().reverse().map(r=>{
     const reasons=failureReasonsForRace(r);
     return `<div class="failure-card"><div class="failure-head"><strong>${esc(r.race?.track)} ${esc(r.race?.raceNo)}R</strong><span>${esc(r.race?.raceDate)}</span></div>${reasons.map(x=>`<div class="failure-item"><strong>${esc(x.label)}</strong><span>${esc(x.detail)}</span></div>`).join('')}</div>`;
   }).join('')+'</div>';
 return summary+detail;
}

function renderDashboard(){
 const races=getAllRaces(),horses=races.flatMap(x=>x.horses||[]),diamonds=horses.filter(x=>x.valueMark||x.mark?.includes?.('💎')),warnings=horses.filter(x=>x.warningMark||x.warning);
 const hit=(race,h)=>horsePosition(race,h)!=null,win=(race,h)=>horsePosition(race,h)===1;
 let dh=0,wh=0;for(const race of races){(race.horses||[]).filter(h=>h.valueMark||h.mark?.includes?.('💎')).forEach(h=>{if(hit(race,h))dh++});(race.horses||[]).filter(h=>h.warningMark||h.warning).forEach(h=>{if(!hit(race,h))wh++})}
 const adv=aggregateAdvanced(races);
 $('dashKpis').innerHTML=[
   ['検証済み',`${races.length}R`],
   ['評価馬数',`${horses.length}頭`],
   ['◎○▲ 1頭以上',pct(adv.top3Any,adv.races)],
   ['平均捕捉',adv.races?`${(adv.top3Captured/adv.races).toFixed(2)}頭`:'—'],
   ['💎複勝率',diamonds.length?`${(dh/diamonds.length*100).toFixed(1)}%`:'—'],
   ['⚠️圏外率',warnings.length?`${(wh/warnings.length*100).toFixed(1)}%`:'—'],
   ['TIME MAE',adv.timeAbs.length?`${mean(adv.timeAbs).toFixed(2)}秒`:'—'],
   ['期待100%+複',pct(adv.ev100Place,adv.ev100N)]
 ].map(([a,b])=>`<div class="kpi"><span>${a}</span><strong>${b}</strong></div>`).join('');

 const modelStats=[
  ['勝率モデル',r=>[...(r.horses||[])].sort((a,b)=>b.win-a.win)[0]],
  ['総合モデル',r=>[...(r.horses||[])].sort((a,b)=>b.overall-a.overall)[0]],
  ['期待値モデル',r=>[...(r.horses||[])].filter(h=>h.ev!=null).sort((a,b)=>b.ev-a.ev)[0]],
  ['CHASS FINAL',r=>{const no=r.finalSnapshot?.top3?.[0]?.horseNo;return (r.horses||[]).find(h=>Number(h.horseNo)===Number(no))||rankFinalFor(r.horses||[])[0]}]
 ];
 const modelHtml='<div class="dash-section"><h3>モデル別成績</h3>'+modelStats.map(([name,pick])=>{let target=0,w=0,p=0,pos=[];races.forEach(r=>{const h=pick(r);if(!h)return;target++;const hp=horsePosition(r,h);if(hp===1)w++;if(hp!=null)p++;if(hp!=null)pos.push(hp)});return `<div class="dash-row"><strong>${name}</strong><span>対象 ${target}</span><span>勝率 ${target?(w/target*100).toFixed(1):'—'}%</span><span>複勝率 ${target?(p/target*100).toFixed(1):'—'}%</span><span>平均着 ${pos.length?mean(pos).toFixed(2):'—'}</span></div>`}).join('')+'</div>';

 const calHtml=`<div class="dash-section"><h3>確率較正・精度</h3>
   <div class="dash-row"><strong>AI勝率</strong><span>MAE ${adv.winMae.length?mean(adv.winMae).toFixed(1)+'pt':'—'}</span><span>Brier ${adv.winBrier.length?mean(adv.winBrier).toFixed(3):'—'}</span><span></span><span></span></div>
   <div class="dash-row"><strong>AI複勝率</strong><span>MAE ${adv.placeMae.length?mean(adv.placeMae).toFixed(1)+'pt':'—'}</span><span>Brier ${adv.placeBrier.length?mean(adv.placeBrier).toFixed(3):'—'}</span><span></span><span></span></div>
   <div class="dash-row"><strong>FINAL順位差</strong><span>平均 ${adv.finalRankAbs.length?mean(adv.finalRankAbs).toFixed(2):'—'}</span><span></span><span></span><span></span></div>
   <div class="dash-row"><strong>💎</strong><span>対象 ${adv.diamondN}</span><span>勝 ${pct(adv.diamondWin,adv.diamondN)}</span><span>複 ${pct(adv.diamondPlace,adv.diamondN)}</span><span>平均人気 ${adv.diamondPop.length?mean(adv.diamondPop).toFixed(1):'—'}</span></div>
 </div>`;

 $('dashModels').innerHTML=modelHtml+calHtml+renderGroupTable('距離別',adv.byDistance)+renderGroupTable('人気帯別',adv.byPopularity)+renderGroupTable('期待値帯別',adv.byEvBand)+renderFailureAnalysis(races);

 $('dashRaces').innerHTML='<div class="dash-section"><h3>保存レース</h3>'+races.slice().reverse().map(r=>{
   const snap=top3Snapshot(r),order=(r.result?.finishOrder||[]).map(Number),captured=snap.filter(x=>order.includes(Number(x.horseNo))).length;
   const terr=(r.horses||[]).map(h=>{const p=timeToSec(h.predictedTime),a=timeToSec(h.actualTime||r.actualTimes?.[String(h.horseNo)]||r.result?.actualTimes?.[String(h.horseNo)]);return p!=null&&a!=null?Math.abs(p-a):null}).filter(x=>x!=null);
   return `<div class="dash-race-card"><strong>${esc(r.race?.track)} ${esc(r.race?.raceNo)}R</strong><span>${esc(r.race?.raceDate)}</span><span>結果 ${r.result.finishOrder.join('-')}</span><span>◎○▲捕捉 ${captured}/3</span><span>TIME MAE ${terr.length?mean(terr).toFixed(2)+'秒':'—'}</span></div>`;
 }).join('')+'</div>';
}
function migrateLegacy(){
 const old=store.get(LEGACY_KEY,{}),now=store.get(KEY,{});
 let changed=false;
 Object.entries(old).forEach(([rid,r])=>{if(!now[rid]){now[rid]=r;changed=true;}});
 if(changed)store.set(KEY,now);
 const lc=store.get(LEGACY_CURRENT,'');if(!store.get(CURRENT,'')&&lc)store.set(CURRENT,lc);
}
initAutoRaceControls();
if($('autoRaceLoad'))$('autoRaceLoad').onclick=loadAutoRace;
if($('autoTrack'))$('autoTrack').onchange=e=>{
  if($('track'))$('track').value=e.target.value;
  if($('autoRaceNo')?.value){if(autoRaceSelectTimer)clearTimeout(autoRaceSelectTimer);autoRaceSelectTimer=setTimeout(()=>loadAutoRace(),180);}
};
if($('autoRaceDate'))$('autoRaceDate').onchange=e=>{
  if($('raceDate'))$('raceDate').value=e.target.value;
  if($('autoRaceNo')?.value){if(autoRaceSelectTimer)clearTimeout(autoRaceSelectTimer);autoRaceSelectTimer=setTimeout(()=>loadAutoRace(),180);}
};
if($('autoRaceNo'))$('autoRaceNo').onchange=e=>{
  if($('raceNo'))$('raceNo').value=e.target.value;
  if(autoRaceSelectTimer)clearTimeout(autoRaceSelectTimer);
  autoRaceSelectTimer=setTimeout(()=>loadAutoRace(),180);
};
$('raceImportFile').addEventListener('change',async e=>{const f=e.target.files?.[0];if(!f)return;try{await importFile(f)}catch(err){$('importStatus').textContent='取込失敗：'+err.message;alert($('importStatus').textContent)}e.target.value=''});
['category','raceDate','track','raceNo','distance','trackCondition','chaos','pace'].forEach(id=>$(id).addEventListener('input',()=>{state.race=raceFromForm();render()}));
$('themeToggle').onclick=()=>document.body.classList.toggle('light');
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===b.dataset.view));if(b.dataset.view==='dashboardView')renderDashboard()});
$('narSync').onclick=syncNar;$('liveOddsSync').onclick=()=>syncLiveOdds(false);$('autoOdds').onchange=e=>setAutoOdds(e.target.checked);$('saveValidation').onclick=saveValidation;$('recalcDash').onclick=renderDashboard;

migrateLegacy();setVersion();
const last=store.get(CURRENT,'')||store.get(LEGACY_CURRENT,''),db=store.get(KEY,{});
if(last&&db[last]){state=db[last];state.actualTimes=state.actualTimes||state.result?.actualTimes||{};state.horses=(state.horses||[]).map(h=>({...h,sourceMark:h.sourceMark||'',abilityMark:h.abilityMark||(['◎','○','▲','△'].includes(h.mark)?h.mark:''),valueMark:h.valueMark||(h.mark?.includes?.('💎')?h.mark:''),warningMark:h.warningMark||h.warning||'',finalMark:h.finalMark||''}));fillRace(state.race);render()}else{fillRace({category:'地方競馬',chaos:50,pace:'標準'});render()}
})();
