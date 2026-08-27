(() => {
'use strict';
const $=id=>document.getElementById(id);
const KEY='chass_v80_races';
const CURRENT='chass_v80_current';
const num=v=>{const n=parseFloat(v);return Number.isFinite(n)?n:null};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const cleanName=s=>String(s??'').replace(/\s+/g,'').trim();
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
const median=a=>{const b=a.filter(x=>x!=null).sort((x,y)=>x-y);if(!b.length)return null;const m=Math.floor(b.length/2);return b.length%2?b[m]:(b[m-1]+b[m])/2};
const arr=v=>Array.isArray(v)?v.map(num).filter(x=>x!=null):typeof v==='string'?v.split(/[,\s/→>]+/).map(num).filter(x=>x!=null):num(v)==null?[]:[num(v)];
const store={get(k,d){try{return JSON.parse(localStorage.getItem(k)||'')??d}catch{return d}},set(k,v){localStorage.setItem(k,JSON.stringify(v))}};

let state={race:{},horses:[],result:null};

function raceId(r={}){
 const d=String(r.raceDate||r.date||'').replaceAll('/','-');
 const t=String(r.track||'').trim();
 const n=String(r.raceNo||'').match(/\d+/)?.[0]||'';
 return d&&t&&n?`${d}|${t}|${n}`:'';
}
function oddsType(v){
 const s=String(v||'');
 if(/予想|想定|forecast|predicted/i.test(s))return '予想オッズ';
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
 let place=b.map(v=>300*v/bs).map(v=>clamp(v,1,88));
 return model.map((m,i)=>({...m,win:win[i],place:place[i],kgScore:kgScore[i]}));
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
     popularity:num(h.popularity??h.pop??h.人気),
     odds:num(h.odds??h.realOdds??h.finalOdds??h.単勝オッズ),
     runningStyle:h.runningStyle??h.style??h.脚質??'不明',
     predictedTime:h.predictedTime??h.time??h.予想走破タイム??'',
     reason:h.reason??h.根拠??'',
     dataConfidence:num(h.dataConfidence??h.confidence)??Math.round(45+d.completeness*45),
     raw:{highest:d.raw.highest,avg5:d.raw.avg,distance:d.raw.distance,course:d.raw.course,recent:d.raw.recent,kg:d.raw.kg},
     scores:{timeIndex:d.score,distanceFit:d.norm.distance,courseFit:d.norm.course,weight:d.kgScore},
     win,place,mark:'',warning:'',overall:0,ev:null,fair:win>0?100/win:null
   };
 });
 // overall independent of market
 const s=horses.map(h=>h.scores.timeIndex??5);const n=normalize(s);
 horses.forEach((h,i)=>h.overall=Math.round(clamp(40+n[i]*6+(h.dataConfidence-50)*.12,0,100)));
 // ability marks
 [...horses].sort((a,b)=>b.win-a.win).slice(0,4).forEach((h,i)=>h.mark=['◎','○','▲','△'][i]);
 if(ot==='実オッズ'){
   horses.forEach(h=>{
    if(h.odds!=null)h.ev=h.odds*h.win;
    if(h.popularity>=10&&h.place>=20&&h.ev>=125)h.mark='💎💎💎';
    else if(h.popularity>=5&&h.place>=22&&h.ev>=112)h.mark='💎';
    if(h.popularity>=1&&h.popularity<=3&&h.ev!=null&&h.ev<75)h.warning=h.ev<55?'⚠️⚠️⚠️':h.ev<65?'⚠️⚠️':'⚠️';
   });
 }
 return {race:r,horses,result:null};
}
function fillRace(r){
 $('category').value=r.category||'地方競馬';$('raceDate').value=(r.raceDate||r.date||'').replaceAll('/','-');$('track').value=r.track||'';$('raceNo').value=r.raceNo||'';$('distance').value=r.distance||'';$('trackCondition').value=r.trackCondition||'不明';$('chaos').value=r.chaos??50;$('pace').value=r.pace||'標準';
}
function raceFromForm(){
 return {...state.race,category:$('category').value,raceDate:$('raceDate').value,track:$('track').value,raceNo:Number($('raceNo').value)||'',distance:Number($('distance').value)||'',trackCondition:$('trackCondition').value,chaos:Number($('chaos').value)||50,pace:$('pace').value||'標準'};
}
function render(){
 state.race=raceFromForm(); const r=state.race,h=state.horses; const rid=raceId(r);
 $('raceTitle').textContent=r.track&&r.raceNo?`${r.track} ${r.raceNo}R`:'レース情報未入力';
 $('raceMeta').textContent=[r.raceDate?String(r.raceDate).slice(5).replace('-','/'):'',r.distance?`${r.distance}m`:'',r.raceName||''].filter(Boolean).join('｜')||'予想データファイルを読み込むと自動表示します。';
 $('chaosBadge').textContent=`波乱度 ${r.chaos??'—'}%`;$('paceBadge').textContent=`展開 ${r.pace||'—'}`;$('biasText').textContent=`馬場：${r.bias||r.trackCondition||'—'}`;
 const prob=h.filter(x=>x.win!=null&&x.place!=null).length,time=h.filter(x=>x.predictedTime).length,market=h.filter(x=>x.odds!=null).length;
 const names=new Set(h.map(x=>cleanName(x.horseName))); const bad=h.some(x=>!x.horseName)||names.size!==h.length;
 $('integrityGrid').innerHTML=[
  ['レースID',rid||'—'],['AI確率',`${prob}/${h.length}頭`],['予想TIME',`${time}/${h.length}頭`],['市場',`${market}/${h.length}頭`],['データ状態',bad?'要確認':'正常']
 ].map(([a,b])=>`<div><span>${a}</span><strong>${esc(b)}</strong></div>`).join('');
 renderFinal();renderQuick();renderHorses();
}
function rankFinal(){
 return [...state.horses].sort((a,b)=>{
   const av=(a.win||0)*.45+(a.place||0)*.15+(a.overall||0)*.25+((a.ev??100)-100)*.08+(a.dataConfidence||0)*.07;
   const bv=(b.win||0)*.45+(b.place||0)*.15+(b.overall||0)*.25+((b.ev??100)-100)*.08+(b.dataConfidence||0)*.07;
   return bv-av;
 });
}
function renderFinal(){
 const h=state.horses;if(!h.length){$('finalBody').innerHTML='予想データを読み込むと自動表示します。';return}
 const picks=rankFinal().slice(0,3), marks=['◎','○','▲']; const diamond=h.filter(x=>x.mark.includes('💎')).sort((a,b)=>(b.ev||0)-(a.ev||0))[0]; const warn=h.filter(x=>x.warning).sort((a,b)=>(a.ev||999)-(b.ev||999))[0];
 $('marketStatus').textContent=state.race.oddsType==='実オッズ'?'市場反映済':state.race.oddsType||'市場待ち';
 $('finalBody').innerHTML=`<div class="final-grid">${picks.map((x,i)=>`<div class="final-pick"><strong>${marks[i]} ${x.horseNo}番 ${esc(x.horseName)}</strong><small>勝 ${x.win.toFixed(1)}% ｜ 複 ${x.place.toFixed(1)}%<br>総合 ${x.overall}/100 ｜ 期待 ${x.ev==null?'市場待ち':x.ev.toFixed(0)+'%'} ｜ AIフェア ${x.fair?x.fair.toFixed(1)+'倍':'—'}</small></div>`).join('')}</div><div class="flags"><div class="flag-box diamond">${diamond?`${diamond.mark} 穴馬：${diamond.horseNo}番 ${esc(diamond.horseName)} ｜ 期待 ${diamond.ev.toFixed(0)}%`:'💎 穴馬：現時点で強い市場乖離なし'}</div><div class="flag-box warning">${warn?`${warn.warning} 人気馬注意：${warn.horseNo}番 ${esc(warn.horseName)} ｜ 期待 ${warn.ev.toFixed(0)}%`:'⚠️ 人気馬リスク：強い該当なし'}</div></div>`;
}
function renderQuick(){
 const h=state.horses;if(!h.length){$('quickList').innerHTML='馬データを入力すると一覧表示します。';return}
 $('quickList').innerHTML=[...h].sort((a,b)=>b.overall-a.overall).map(x=>`<div class="quick-row"><div class="quick-no">${x.horseNo}</div><div class="quick-name">${esc(x.mark)} ${esc(x.horseName)}</div><div class="quick-stat"><span>勝</span><strong>${x.win.toFixed(1)}%</strong></div><div class="quick-stat"><span>複</span><strong>${x.place.toFixed(1)}%</strong></div><div class="quick-stat"><span>TIME</span><strong>${esc(x.predictedTime||'—')}</strong></div><div class="quick-stat"><span>総合</span><strong>${x.overall}</strong></div></div>`).join('');
}
function renderHorses(){
 const list=$('horseList');list.innerHTML=''; const tpl=$('horseTpl');
 state.horses.forEach(x=>{
   const n=tpl.content.cloneNode(true),row=n.querySelector('.horse-row');n.querySelector('.horse-no').textContent=x.horseNo;n.querySelector('.horse-mark-name').textContent=`${x.mark||''} ${x.horseName}`.trim();n.querySelector('.horse-sub').textContent=[x.runningStyle,x.popularity?`${x.popularity}人気`:'',x.odds?`${x.odds}倍`:''].filter(Boolean).join('｜');n.querySelector('.overall-pill').textContent=`総合 ${x.overall}`;n.querySelector('.m-win').textContent=x.win.toFixed(1)+'%';n.querySelector('.m-place').textContent=x.place.toFixed(1)+'%';n.querySelector('.m-time').textContent=x.predictedTime||'—';n.querySelector('.m-overall').textContent=x.overall; const raw=x.raw;n.querySelector('.facts').innerHTML=`最高指数 ${raw.highest??'—'} / 5走平均 ${raw.avg5??'—'} / 距離 ${raw.distance??'—'} / コース ${raw.course??'—'} / 近走 ${raw.recent.length?raw.recent.join('→'):'—'} / 斤量 ${raw.kg??'—'}kg`;n.querySelector('.logic').innerHTML=`指数スコア ${x.scores.timeIndex?.toFixed(1)??'—'} / 距離適性 ${x.scores.distanceFit?.toFixed(1)??'—'} / コース適性 ${x.scores.courseFit?.toFixed(1)??'—'} / 斤量補正 ${x.scores.weight?.toFixed(1)??'—'} / 信頼度 ${x.dataConfidence}%`;n.querySelector('.reason').textContent=x.reason||'根拠データなし';list.appendChild(n);
 });
}
async function importFile(f){
 const text=(await f.text()).replace(/^\uFEFF/,'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');let root;try{root=JSON.parse(text)}catch(e){throw new Error('JSON構文エラー: '+e.message)}
 state=transform(root);fillRace(state.race);persist(false);render();$('importStatus').textContent=`✓ Ver.8.0：${state.horses.length}頭読込 / AI勝率・複勝率計算済 / TIME ${state.horses.filter(x=>x.predictedTime).length}頭 / ${state.race.oddsType}`;
}
function persist(validated=true){
 state.race=raceFromForm();const rid=raceId(state.race);if(!rid)return;const db=store.get(KEY,{});db[rid]={...state,updatedAt:new Date().toISOString(),validated};store.set(KEY,db);store.set(CURRENT,rid);
}
function narCode(track){return {'船橋':19,'笠松':22,'園田':27,'姫路':28,'門別':36}[track]||null}
async function syncNar(){
 const r=raceFromForm(),code=narCode(r.track);if(!code){$('narStatus').textContent='NAR自動取得は現在 船橋/笠松/園田/姫路/門別に対応。';return}
 const u=`/api/nar/sync?code=${code}&date=${encodeURIComponent(r.raceDate)}&race=${r.raceNo}`;$('narStatus').textContent='NAR公式を確認中…';
 try{const res=await fetch(u);const d=await res.json();if(!res.ok)throw new Error(d.error||'取得失敗');if(d.finishOrder?.length>=3){$('finish1').value=d.finishOrder[0];$('finish2').value=d.finishOrder[1];$('finish3').value=d.finishOrder[2]}if(Array.isArray(d.odds)&&d.odds.length){const map=new Map(d.odds.map(x=>[String(x.horseNo),num(x.odds)]));state.horses.forEach(h=>{const o=map.get(String(h.horseNo));if(o!=null){h.odds=o;h.ev=o*h.win}});state.race.oddsType='実オッズ';}render();$('narStatus').textContent=`NAR公式反映：着順 ${d.finishOrder?.join('-')||'未確定'} / オッズ ${d.odds?.length||0}頭`;persist(false)}catch(e){$('narStatus').textContent='取得失敗：'+e.message}
}
function saveValidation(){
 const f=[num($('finish1').value),num($('finish2').value),num($('finish3').value)].filter(x=>x!=null);if(f.length<3){alert('1〜3着を入力してください');return}state.result={finishOrder:f,memo:$('memo').value,at:new Date().toISOString()};persist(true);renderDashboard();alert('検証結果を保存しました。');
}
function renderDashboard(){
 const db=store.get(KEY,{}),races=Object.values(db).filter(x=>x.validated&&x.result?.finishOrder?.length>=3);const horses=races.flatMap(x=>x.horses);const diamonds=horses.filter(x=>x.mark?.includes('💎')),warnings=horses.filter(x=>x.warning);
 const hit=(race,h)=>race.result.finishOrder.includes(Number(h.horseNo));const win=(race,h)=>race.result.finishOrder[0]===Number(h.horseNo);
 let dh=0,dw=0,wh=0;for(const race of races){race.horses.filter(h=>h.mark?.includes('💎')).forEach(h=>{if(hit(race,h))dh++;if(win(race,h))dw++});race.horses.filter(h=>h.warning).forEach(h=>{if(!hit(race,h))wh++})}
 $('dashKpis').innerHTML=[['検証済み',`${races.length}R`],['評価馬数',`${horses.length}頭`],['💎複勝率',diamonds.length?`${(dh/diamonds.length*100).toFixed(1)}%`:'—'],['⚠️圏外率',warnings.length?`${(wh/warnings.length*100).toFixed(1)}%`:'—']].map(([a,b])=>`<div class="kpi"><span>${a}</span><strong>${b}</strong></div>`).join('');
 const modelStats=[['勝率モデル',r=>[...r.horses].sort((a,b)=>b.win-a.win)[0]],['総合モデル',r=>[...r.horses].sort((a,b)=>b.overall-a.overall)[0]],['期待値モデル',r=>[...r.horses].filter(h=>h.ev!=null).sort((a,b)=>b.ev-a.ev)[0]],['CHASS FINAL',r=>{const old=state;state=r;const x=rankFinal()[0];state=old;return x}]];
 $('dashModels').innerHTML='<div class="dash-section"><h3>モデル別成績</h3>'+modelStats.map(([name,pick])=>{let target=0,w=0,p=0;races.forEach(r=>{const h=pick(r);if(!h)return;target++;if(r.result.finishOrder[0]===Number(h.horseNo))w++;if(r.result.finishOrder.includes(Number(h.horseNo)))p++});return `<div class="dash-row"><strong>${name}</strong><span>対象 ${target}</span><span>勝率 ${target?(w/target*100).toFixed(1):'—'}%</span><span>複勝率 ${target?(p/target*100).toFixed(1):'—'}%</span><span>1着 ${w}</span></div>`}).join('')+'</div>';
 $('dashRaces').innerHTML='<div class="dash-section"><h3>保存レース</h3>'+races.slice().reverse().map(r=>`<div class="dash-row"><strong>${esc(r.race.track)} ${esc(r.race.raceNo)}R</strong><span>${esc(r.race.raceDate)}</span><span>${r.result.finishOrder.join('-')}</span><span>${r.horses.length}頭</span><span>${esc(r.result.memo||'')}</span></div>`).join('')+'</div>';
}
$('raceImportFile').addEventListener('change',async e=>{const f=e.target.files?.[0];if(!f)return;try{await importFile(f)}catch(err){$('importStatus').textContent='取込失敗：'+err.message;alert($('importStatus').textContent)}e.target.value=''});
['category','raceDate','track','raceNo','distance','trackCondition','chaos','pace'].forEach(id=>$(id).addEventListener('input',()=>{state.race=raceFromForm();render()}));
$('themeToggle').onclick=()=>document.body.classList.toggle('light');
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===b.dataset.view));if(b.dataset.view==='dashboardView')renderDashboard()});
$('narSync').onclick=syncNar;$('saveValidation').onclick=saveValidation;$('recalcDash').onclick=renderDashboard;
const last=store.get(CURRENT,'');const db=store.get(KEY,{});if(last&&db[last]){state=db[last];fillRace(state.race);render()}else{fillRace({category:'地方競馬',chaos:50,pace:'標準'});render()}
})();