const $ = id => document.getElementById(id);
const fields = ['category','raceDate','track','raceNo','distance','chaos','bias','pace','simNormal','simHigh','simSlow','valueNotes','riskNotes','summary','result1','result2','result3','review','oddsType','oddsCheckedAt'];
const horseList = $('horseList');
const tpl = $('horseTemplate');
const KEY='chass_keiba_lab_v1';
const LOGICS={runTheory:'走破理論',timeIndex:'タイム指数',paceFit:'展開適性',trackFit:'馬場適性',distanceFit:'距離適性',courseFit:'コース適性',bounce:'叩き効果',lastRaceMemory:'前走記憶',loadLap:'5・7・9H負荷',training:'調教',draw:'枠',weight:'斤量',jockey:'騎手'};

function updateLogicAverage(row){
  const vals=[...row.querySelectorAll('.logic-score')].map(x=>num(x.value)).filter(x=>x!==null);
  const safe=vals.map(v=>Math.max(0,Math.min(10,v)));
  const avg=safe.length?safe.reduce((a,b)=>a+b,0)/safe.length:null;
  const el=row.querySelector('.logic-average'); if(el) el.textContent=avg===null?'平均 —':`平均 ${avg.toFixed(1)}`;
}


function addHorse(data={}){
  const node=tpl.content.cloneNode(true);
  const row=node.querySelector('.horse-row');
  const map={'horse-no':'',mark:'◎','horse-name':'',win:'',place:'',ev:'',time:'',pop:'',odds:'','running-style':'先行',variance:'2.0','position-fail':'12','actual-time':'','data-confidence':'',reason:''};
  Object.entries(map).forEach(([cls,def])=>{ const el=row.querySelector('.'+cls); if(el) el.value=data[cls] ?? def; });
  const logic=data.logic||{};
  row.querySelectorAll('.logic-score').forEach(el=>{el.value=logic[el.dataset.logic] ?? ''; el.addEventListener('input',()=>updateLogicAverage(row));});
  updateLogicAverage(row);
  row.querySelectorAll('input,select,textarea').forEach(el=>el.addEventListener('change',()=>{ if(document.body.contains(row)) renderAllAiBreakdowns(); }));
  row.querySelector('.remove').onclick=()=>row.remove();
  horseList.appendChild(node);
  const liveRow=horseList.lastElementChild;
  if(liveRow) consolidateHorseDetails(liveRow);
}


function consolidateHorseDetails(row){
  if(!row || row.querySelector(':scope > .horse-all-details')) return;
  const detail=document.createElement('details');
  detail.className='horse-all-details';
  const sum=document.createElement('summary');
  sum.textContent='詳細分析を見る';
  const body=document.createElement('div');
  body.className='horse-all-details-body';
  detail.appendChild(sum); detail.appendChild(body);

  const targets=[
    row.querySelector('.horse-input-panel'),
    row.querySelector('.sim-result'),
    row.querySelector('.ai-panel'),
    row.querySelector('.reason'),
    row.querySelector('.logic-panel')
  ].filter(Boolean);

  const fact=row.querySelector('.fact-summary');
  if(fact) row.insertBefore(detail, fact.nextSibling);
  else row.appendChild(detail);

  targets.forEach(el=>{
    if(el.classList.contains('horse-input-panel') || el.classList.contains('ai-panel')){
      el.open=true;
      const s=el.querySelector(':scope > summary'); if(s) s.hidden=true;
    }
    body.appendChild(el);
  });
}

function horseFromRow(r){
  return {
    'horse-no':r.querySelector('.horse-no')?.value ?? '',
    'horse-no':r.querySelector('.horse-no')?.value ?? '',
    mark:r.querySelector('.mark').value,
    'horse-name':r.querySelector('.horse-name').value.trim(),
    win:r.querySelector('.win').value, place:r.querySelector('.place').value,
    ev:r.querySelector('.ev').value, time:r.querySelector('.time').value.trim(),
    pop:r.querySelector('.pop').value, odds:r.querySelector('.odds').value,
    'running-style':r.querySelector('.running-style').value, variance:r.querySelector('.variance').value, 'position-fail':r.querySelector('.position-fail').value,
    'actual-time':r.querySelector('.actual-time').value.trim(),
    'data-confidence':r.querySelector('.data-confidence')?.value ?? '',
    reason:r.querySelector('.reason').value.trim(),
    logic:Object.fromEntries([...r.querySelectorAll('.logic-score')].map(el=>[el.dataset.logic,el.value]))
  };
}
function getHorses(){
  return [...document.querySelectorAll('.horse-row')].map(r=>horseFromRow(r)).filter(h=>h['horse-name']||h.reason);
}
/* legacy body removed */
function _legacyGetHorses(){
  return [...document.querySelectorAll('.horse-row')].map(r=>({
    mark:r.querySelector('.mark').value,
    'horse-name':r.querySelector('.horse-name').value.trim(),
    win:r.querySelector('.win').value, place:r.querySelector('.place').value,
    ev:r.querySelector('.ev').value, time:r.querySelector('.time').value.trim(),
    pop:r.querySelector('.pop').value, odds:r.querySelector('.odds').value,
    'running-style':r.querySelector('.running-style').value, variance:r.querySelector('.variance').value, 'position-fail':r.querySelector('.position-fail').value,
    'actual-time':r.querySelector('.actual-time').value.trim(),
    'data-confidence':r.querySelector('.data-confidence')?.value ?? '',
    reason:r.querySelector('.reason').value.trim(),
    logic:Object.fromEntries([...r.querySelectorAll('.logic-score')].map(el=>[el.dataset.logic,el.value]))
  })).filter(h=>h['horse-name']||h.reason);
}

function getForm(){ const o={}; fields.forEach(f=>o[f]=$(f).value); o.horses=getHorses(); o.updatedAt=new Date().toISOString(); const ss=$('simulationSummary')?.dataset; if(ss?.runs){o.simulation={runs:Number(ss.runs),executedAt:ss.executedAt||'',normal:Number(ss.normal||0),high:Number(ss.high||0),slow:Number(ss.slow||0)};} return o; }
function fillForm(d){ fields.forEach(f=>$(f).value=d[f]??''); setAutoOddsMeta(d.oddsType||'オッズなし',d.oddsCheckedAt||''); horseList.innerHTML=''; (d.horses||[]).forEach(addHorse); if(!(d.horses||[]).length) for(let i=0;i<5;i++) addHorse(); renderAllAiBreakdowns(); showView('predictionView'); scrollTo({top:0,behavior:'smooth'}); }
function loadAll(){ try{return JSON.parse(localStorage.getItem(KEY)||'[]')}catch{return[]} }
function saveAll(v){localStorage.setItem(KEY,JSON.stringify(v));}
function esc(s=''){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));}
function pct(a,b){return b?((a/b)*100).toFixed(1)+'%':'—';}
function num(v){const n=parseFloat(v);return Number.isFinite(n)?n:null;}
function resultNames(r){return [r.result1,r.result2,r.result3].map(x=>(x||'').trim()).filter(Boolean);}
function isComplete(r){return resultNames(r).length>0;}
function horsePosition(r,h){const n=(h['horse-name']||'').trim(); if(!n)return null; const i=resultNames(r).indexOf(n); return i>=0?i+1:null;}

function renderArchive(){
  const all=loadAll(); $('saveCount').textContent=all.length+'件';
  $('archive').innerHTML=all.length?all.map((d,i)=>{
    const hs=(d.horses||[]).slice(0,5).map(h=>`<span class="chip">${h['horse-no']?esc(h['horse-no'])+'番 ':''}${esc(h.mark)} ${esc(h['horse-name'])}</span>`).join('');
    const done=isComplete(d)?'<span class="status done">結果入力済</span>':'<span class="status pending">結果待ち</span>';
    return `<div class="archive-item"><div class="archive-title"><strong>${esc(d.raceDate||'日付未設定')} ${esc(d.track||'競馬場未設定')} ${esc(d.raceNo||'?')}R</strong><span class="badge">波乱度 ${esc(d.chaos||'-')}%</span></div><div class="muted">${esc(d.category||'')} / ${d.distance?esc(d.distance)+'m / ':''}${esc(d.pace||'展開未入力')} / ${esc(d.bias||'馬場未入力')}</div><div>${done}</div><div class="chips">${hs}</div><div class="archive-actions"><button class="ghost" onclick="openSaved(${i})">開く</button><button class="danger" onclick="deleteSaved(${i})">削除</button></div></div>`;
  }).join(''):'<p class="muted">まだ保存された予想はありません。</p>';
}
window.openSaved=i=>fillForm(loadAll()[i]);
window.deleteSaved=i=>{if(!confirm('この保存データを削除しますか？'))return; const all=loadAll();all.splice(i,1);saveAll(all);renderArchive();renderDashboard();};

function saveCurrent(){
  renderValueRanking();
  const d=getForm(); const all=loadAll();
  const idx=all.findIndex(x=>x.raceDate===d.raceDate && x.track===d.track && String(x.raceNo)===String(d.raceNo));
  if(idx>=0){ if(confirm('同じ日付・競馬場・レースの保存があります。上書きしますか？')) all[idx]=d; else all.unshift(d); }
  else all.unshift(d);
  saveAll(all); renderArchive(); renderDashboard(); alert('予想を保存しました');
}

function parseTime(s){
  if(!s)return null; const t=String(s).trim();
  if(/^\d+(\.\d+)?$/.test(t))return parseFloat(t);
  const m=t.match(/^(\d+):([0-5]?\d(?:\.\d+)?)$/); if(!m)return null;
  return parseInt(m[1],10)*60+parseFloat(m[2]);
}
function formatSec(s){ if(!Number.isFinite(s))return '—'; return s.toFixed(2)+'秒'; }

function markAggregate(races){
  const marks=['◎','○','▲','△','☆','💎','💎💎💎','⚠️']; const out={}; marks.forEach(m=>out[m]={n:0,win:0,place:0});
  races.filter(isComplete).forEach(r=>(r.horses||[]).forEach(h=>{ if(!out[h.mark])return; out[h.mark].n++; const p=horsePosition(r,h); if(p===1)out[h.mark].win++; if(p&&p<=3)out[h.mark].place++; }));
  return out;
}

function calibration(races,key,successFn){
  const bins=[0,10,20,30,40,50,60,70,80,90,100].map((v,i)=>i<10?{lo:v,hi:v+10,n:0,sum:0,hit:0}:null).filter(Boolean);
  races.filter(isComplete).forEach(r=>(r.horses||[]).forEach(h=>{const p=num(h[key]); if(p===null)return; const idx=Math.min(9,Math.floor(Math.max(0,Math.min(99.999,p))/10)); bins[idx].n++; bins[idx].sum+=p; if(successFn(r,h))bins[idx].hit++;}));
  return bins;
}

function renderBars(el,bins){
  $(el).innerHTML=bins.map(b=>{const actual=b.n?b.hit/b.n*100:0; const pred=b.n?b.sum/b.n:0; return `<div class="bar-row"><div class="bar-label">${b.lo}–${b.hi}% <span>${b.n}頭</span></div><div class="bar-track"><div class="bar pred" style="width:${Math.min(100,pred)}%"></div><div class="bar actual" style="width:${Math.min(100,actual)}%"></div></div><div class="bar-values">予測 ${b.n?pred.toFixed(1):'—'}% / 実績 ${b.n?actual.toFixed(1):'—'}%</div></div>`;}).join('');
}

function segmentRows(races,getKey){
  const m={}; races.filter(isComplete).forEach(r=>(r.horses||[]).forEach(h=>{const key=getKey(r,h); if(!key)return; m[key]??={n:0,win:0,place:0}; m[key].n++; const p=horsePosition(r,h); if(p===1)m[key].win++; if(p&&p<=3)m[key].place++;})); return Object.entries(m).sort((a,b)=>b[1].n-a[1].n);
}
function renderMini(id,rows){ $(id).innerHTML=rows.length?rows.map(([k,v])=>`<div class="mini-row"><strong>${esc(k)}</strong><span>${v.n}頭 / 勝 ${pct(v.win,v.n)} / 複 ${pct(v.place,v.n)}</span></div>`).join(''):'<p class="muted">集計できるデータがありません。</p>'; }

function renderLogicStats(races){
  const completed=races.filter(isComplete);
  let allN=0, allPlace=0;
  completed.forEach(r=>(r.horses||[]).forEach(h=>{allN++; const p=horsePosition(r,h); if(p&&p<=3)allPlace++;}));
  const base=allN?allPlace/allN*100:null;
  const rows=Object.entries(LOGICS).map(([key,label])=>{
    let n=0,win=0,place=0;
    completed.forEach(r=>(r.horses||[]).forEach(h=>{
      const score=num(h.logic?.[key]); if(score===null||score<7)return;
      n++; const p=horsePosition(r,h); if(p===1)win++; if(p&&p<=3)place++;
    }));
    const placeRate=n?place/n*100:null;
    const diff=(placeRate!==null&&base!==null)?placeRate-base:null;
    return {label,n,win,place,placeRate,diff};
  });
  $('logicStats').innerHTML=rows.map(v=>`<tr><td><strong>${esc(v.label)}</strong></td><td>${v.n}</td><td>${pct(v.win,v.n)}</td><td>${pct(v.place,v.n)}</td><td>${v.diff===null?'—':`${v.diff>=0?'+':''}${v.diff.toFixed(1)}pt`}</td></tr>`).join('');
}


function updateDashboardVisibility(all, completed, errs){
  const hasCompleted=completed.length>0;
  const hasLogic=completed.some(r=>(r.horses||[]).some(h=>Object.values(h.logic||{}).some(v=>num(v)!==null)));
  const hasPop=completed.some(r=>(r.horses||[]).some(h=>num(h.pop)!==null));
  const hasSegment=hasCompleted && completed.some(r=>r.track || r.distance || r.chaos || (r.horses||[]).some(h=>num(h['data-confidence'])!==null));
  const set=(id,show)=>{const e=$(id);if(e)e.hidden=!show;};
  set('dashMarks',hasCompleted);
  set('dashCalibration',hasCompleted);
  set('dashLogic',hasLogic);
  set('dashTime',errs.length>0);
  set('dashSegments',hasSegment || hasPop);
}

function renderDashboard(){
  const all=loadAll(), completed=all.filter(isComplete); let totalH=0, top3=0, diamonds=0, diamondPlace=0, warnings=0, warningOut=0;
  completed.forEach(r=>(r.horses||[]).forEach(h=>{totalH++; const p=horsePosition(r,h); if(p&&p<=3)top3++; if(h.mark==='💎'||h.mark==='💎💎💎'){diamonds++; if(p&&p<=3)diamondPlace++;} if(h.mark==='⚠️'){warnings++; if(!p)warningOut++;}}));
  $('kpiGrid').innerHTML=[
    ['検証済みレース',completed.length+'R','結果入力済み'],
    ['評価馬数',totalH+'頭','検証対象'],
    ['💎穴馬 複勝率',pct(diamondPlace,diamonds),diamonds+'頭中 '+diamondPlace+'頭'],
    ['⚠️危険馬 圏外率',pct(warningOut,warnings),warnings+'頭中 '+warningOut+'頭']
  ].map(x=>`<div class="kpi"><span>${x[0]}</span><strong>${x[1]}</strong><small>${x[2]}</small></div>`).join('');

  const marks=markAggregate(all); $('markStats').innerHTML=Object.entries(marks).map(([m,v])=>`<tr><td><strong>${m}</strong></td><td>${v.n}</td><td>${v.win}</td><td>${v.place}</td><td>${pct(v.win,v.n)}</td><td>${pct(v.place,v.n)}</td></tr>`).join('');
  renderBars('winCalibration',calibration(all,'win',(r,h)=>horsePosition(r,h)===1));
  renderBars('placeCalibration',calibration(all,'place',(r,h)=>{const p=horsePosition(r,h);return p&&p<=3;}));
  renderLogicStats(all);

  const errs=[]; completed.forEach(r=>(r.horses||[]).forEach(h=>{const a=parseTime(h['actual-time']),p=parseTime(h.time); if(a!==null&&p!==null)errs.push({e:Math.abs(p-a),signed:p-a,name:h['horse-name'],track:r.track,distance:r.distance});}));
  updateDashboardVisibility(all,completed,errs);
  if(errs.length){ const mae=errs.reduce((s,x)=>s+x.e,0)/errs.length; const bias=errs.reduce((s,x)=>s+x.signed,0)/errs.length; const within05=errs.filter(x=>x.e<=0.5).length; const within10=errs.filter(x=>x.e<=1.0).length; $('timeStats').innerHTML=`<div class="kpi-grid compact"><div class="kpi"><span>平均絶対誤差 MAE</span><strong>${formatSec(mae)}</strong><small>${errs.length}頭</small></div><div class="kpi"><span>平均予測バイアス</span><strong>${bias>=0?'+':''}${bias.toFixed(2)}秒</strong><small>＋は予想が遅め</small></div><div class="kpi"><span>±0.5秒以内</span><strong>${pct(within05,errs.length)}</strong><small>${within05}頭</small></div><div class="kpi"><span>±1.0秒以内</span><strong>${pct(within10,errs.length)}</strong><small>${within10}頭</small></div></div>`; }
  else $('timeStats').innerHTML='<p class="muted">予想走破タイムと実走タイムの両方を入力すると集計されます。</p>';

  renderMini('trackStats',segmentRows(all,(r)=>r.track||'競馬場未設定'));
  renderMini('distanceStats',segmentRows(all,(r)=>r.distance?`${r.distance}m`:'距離未設定'));
  renderMini('popStats',segmentRows(all,(r,h)=>{const p=num(h.pop); if(p===null)return '人気未設定'; if(p<=3)return '1〜3人気'; if(p<=6)return '4〜6人気'; if(p<=9)return '7〜9人気'; return '10人気以下';}));
  renderMini('chaosStats',segmentRows(all,(r)=>{const c=num(r.chaos); if(c===null)return '未設定'; if(c<40)return '0〜39%'; if(c<60)return '40〜59%'; if(c<80)return '60〜79%'; return '80〜100%';}));
  renderMini('confidenceStats',segmentRows(all,(r,h)=>{const c=derivedConfidence(h); if(c>=80)return '高信頼 80〜100%'; if(c>=60)return '中信頼 60〜79%'; return '低信頼 0〜59%';}));
}


function clamp(v,lo=0,hi=100){return Math.max(lo,Math.min(hi,v));}
function logicScore100(h,key,fallback=50){const v=num(h.logic?.[key]);return v===null?fallback:clamp(v*10);}
function derivedConfidence(h){
  const explicit=num(h['data-confidence']); if(explicit!==null)return clamp(explicit);
  let points=0,max=0;
  const checks=[
    [parseTime(h.time)!==null,20],[!!h['running-style'],8],[num(h.variance)!==null,7],[num(h['position-fail'])!==null,7],
    [num(h.pop)!==null,4],[num(h.odds)!==null,4],[!!h.reason,8]
  ];
  checks.forEach(([ok,w])=>{max+=w;if(ok)points+=w;});
  Object.keys(LOGICS).forEach(k=>{max+=42/Object.keys(LOGICS).length;if(num(h.logic?.[k])!==null)points+=42/Object.keys(LOGICS).length;});
  return max?clamp(points/max*100):0;
}
function fieldTimeScore(h,allHorses){
  const t=parseTime(h.time); const ts=allHorses.map(x=>parseTime(x.time)).filter(Number.isFinite).sort((a,b)=>a-b);
  if(t===null||ts.length<2)return 50;
  const best=ts[0], worst=ts[ts.length-1], span=Math.max(.4,worst-best);
  return clamp(95-((t-best)/span)*65,20,95);
}
function aiBreakdown(h,allHorses){
  const items=[
    ['走破能力',fieldTimeScore(h,allHorses),'予想走破タイムのフィールド内相対評価'],
    ['タイム指数',logicScore100(h,'timeIndex'),'入力済みタイム指数評価'],
    ['距離適性',logicScore100(h,'distanceFit'),'距離適性スコア'],
    ['コース適性',logicScore100(h,'courseFit'),'コース適性スコア'],
    ['近走再現性',clamp(100-(num(h.variance)??2)*12),'ブレ幅から算出（小さいほど高評価）'],
    ['脚質×展開',logicScore100(h,'paceFit'),'展開適性スコア'],
    ['馬場適性',logicScore100(h,'trackFit'),'馬場適性スコア'],
    ['位置取り安定',clamp(100-(num(h['position-fail'])??12)),'位置取り失敗率の逆指標'],
    ['叩き効果',logicScore100(h,'bounce'),'叩き効果スコア'],
    ['走破理論',logicScore100(h,'runTheory'),'走破理論スコア'],
    ['5・7・9H負荷',logicScore100(h,'loadLap'),'負荷ラップ評価'],
    ['前走記憶',logicScore100(h,'lastRaceMemory'),'前走記憶理論スコア'],
    ['データ信頼度',derivedConfidence(h),'入力充足度。手動指定があれば優先']
  ];
  const weights={'走破能力':1.8,'タイム指数':1.25,'距離適性':.9,'コース適性':.9,'近走再現性':1.0,'脚質×展開':1.0,'馬場適性':.8,'位置取り安定':1.0,'叩き効果':.55,'走破理論':1.15,'5・7・9H負荷':.8,'前走記憶':.65,'データ信頼度':.9};
  let sw=0,ss=0; items.forEach(x=>{const w=weights[x[0]]||1;sw+=w;ss+=x[1]*w;});
  const overall=sw?ss/sw:50;
  return {items,overall:clamp(overall)};
}
function renderAiBreakdown(row,allHorses){
  const h=horseFromRow(row), b=aiBreakdown(h,allHorses), win=num(h.win);
  const el=row.querySelector('.ai-breakdown'); if(!el)return;
  const strongest=[...b.items].sort((a,b)=>b[1]-a[1]).slice(0,3).map(x=>`${x[0]} ${x[1].toFixed(0)}`).join(' / ');
  const weakest=[...b.items].sort((a,b)=>a[1]-b[1]).slice(0,2).map(x=>`${x[0]} ${x[1].toFixed(0)}`).join(' / ');
  el.innerHTML=`<div class="ai-score-head"><div><span>AI総合評価</span><strong>${b.overall.toFixed(0)}/100</strong></div><div><span>Sim勝率</span><strong>${win===null?'—':win.toFixed(1)+'%'}</strong></div><div><span>信頼度</span><strong>${derivedConfidence(h).toFixed(0)}%</strong></div></div><div class="ai-bars">${b.items.map(([label,val,note])=>`<div class="ai-bar-row" title="${esc(note)}"><div><span>${esc(label)}</span><em>${val.toFixed(0)}</em></div><div class="ai-bar-track"><i style="width:${clamp(val)}%"></i></div></div>`).join('')}</div><p class="ai-key"><strong>主なプラス:</strong> ${esc(strongest)}<br><strong>要確認:</strong> ${esc(weakest)}</p><p class="hint">総合評価は入力要素の見える化スコアです。Sim勝率そのものは6,000回シミュレーション結果で、同じ意味ではありません。</p>`;
}
function refreshCompactSummary(row,allHorses){
  const h=horseFromRow(row), b=aiBreakdown(h,allHorses);
  const win=num(h.win), place=num(h.place), conf=derivedConfidence(h);
  const set=(sel,val)=>{const el=row.querySelector(sel);if(el)el.textContent=val;};
  set('.quick-win',win===null?'—':win.toFixed(1)+'%');
  set('.quick-place',place===null?'—':place.toFixed(1)+'%');
  set('.quick-time',h.time||'—');
  set('.quick-score',b.overall.toFixed(0)+'/100');
  set('.quick-confidence',conf.toFixed(0)+'%');
}
function renderQuickCompare(){
  const el=$('quickCompare'); if(!el)return;
  const rows=[...document.querySelectorAll('.horse-row')].map((r,i)=>{
    const h=horseFromRow(r); if(!h['horse-name'])return null;
    const b=aiBreakdown(h,[...document.querySelectorAll('.horse-row')].map(horseFromRow));
    return {no:h['horse-no']||String(i+1),mark:h.mark,name:h['horse-name'],win:num(h.win),place:num(h.place),score:b.overall,time:h.time||''};
  }).filter(Boolean);
  if(!rows.length){el.innerHTML='<p class="muted">馬データを入力すると一覧表示します。</p>';return;}
  rows.sort((a,b)=>(b.win??-1)-(a.win??-1));
  el.innerHTML=`<table class="quick-table"><thead><tr><th>馬番</th><th>印</th><th>馬名</th><th>勝率</th><th>複勝</th><th>総合</th><th>TIME</th></tr></thead><tbody>${rows.map(x=>`<tr><td><strong class="horse-number-badge">${esc(x.no)}</strong></td><td>${esc(x.mark)}</td><td><strong>${x.no?esc(x.no)+'番 ':''}${esc(x.name)}</strong></td><td>${x.win===null?'—':x.win.toFixed(1)+'%'}</td><td>${x.place===null?'—':x.place.toFixed(1)+'%'}</td><td>${x.score.toFixed(0)}</td><td>${esc(x.time||'—')}</td></tr>`).join('')}</tbody></table>`;
}
function renderAllAiBreakdowns(){
  const rows=[...document.querySelectorAll('.horse-row')], hs=rows.map(horseFromRow);
  rows.forEach(r=>{consolidateHorseDetails(r);renderAiBreakdown(r,hs);refreshCompactSummary(r,hs);});
  renderQuickCompare();
}
function normalRand(){let u=0,v=0;while(!u)u=Math.random();while(!v)v=Math.random();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);}
function logicAvgHorse(h){const vals=Object.values(h.logic||{}).map(num).filter(v=>v!==null);return vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:5;}
function scenarioAdjustment(style,sc){const m={normal:{逃げ:0,先行:0,差し:0,追込:0},high:{逃げ:.7,先行:.25,差し:-.25,追込:-.15},slow:{逃げ:-.4,先行:-.2,差し:.3,追込:.55}};return m[sc]?.[style]??0;}
function simBadge(ev,pop,place){if(ev>=135&&pop>=10&&place>=18)return '💎💎💎';if(ev>=115&&pop>=4&&place>=20)return '💎';if(ev<75&&pop>0&&pop<=3)return '⚠️';return '—';}
function runSimulation(){
  const rows=[...document.querySelectorAll('.horse-row')]; if(rows.length<2){alert('2頭以上入力してください');return false;}
  const probs=[num($('simNormal').value)||0,num($('simHigh').value)||0,num($('simSlow').value)||0], sum=probs.reduce((a,b)=>a+b,0); if(sum<=0){alert('展開確率を入力してください');return false;}
  const horses=rows.map(r=>{const h=horseFromRow(r);return {r,h,base:parseTime(h.time),wins:0,places:0,totalTime:0,countTime:0,logic:logicAvgHorse(h)};});
  const named=horses.filter(x=>x.h['horse-name']); if(named.length<2){alert('馬名を2頭以上入力してください');return false;}
  const valid=named.filter(x=>x.base!==null);
  named.filter(x=>x.base===null).forEach(x=>{x.r.querySelector('.sim-result').innerHTML='<strong>予想タイム不足</strong><span>シミュレーション対象外</span>';});
  if(valid.length<2){alert('予想走破タイムを2頭以上入力してください');return false;}
  const N=6000, names=['normal','high','slow'];
  for(let k=0;k<N;k++){
    let z=Math.random()*sum, sc=names[0]; if(z<probs[0])sc='normal'; else if(z<probs[0]+probs[1])sc='high'; else sc='slow';
    const scores=valid.map(x=>{const fail=Math.random()<((num(x.h['position-fail'])||0)/100); const vr=Math.max(.002,(num(x.h.variance)||2)/100); const base=x.base; const logicAdj=(5-x.logic)*0.12; const scen=scenarioAdjustment(x.h['running-style'],sc); const noise=normalRand()*base*vr; const failPenalty=fail?base*.012:0; const t=base+logicAdj+scen+noise+failPenalty; x.totalTime+=t;x.countTime++;return {x,t};}).sort((a,b)=>a.t-b.t);
    scores[0].x.wins++; scores.slice(0,Math.min(3,scores.length)).forEach(y=>y.x.places++);
  }
  let totalWin=0,totalPlace=0;
  valid.forEach(x=>{const wp=x.wins/N*100, pp=x.places/N*100, avg=x.totalTime/x.countTime, odds=num(x.h.odds), ev=odds?wp*odds:null, pop=num(x.h.pop)||0, badge=simBadge(ev??0,pop,pp); totalWin+=wp;totalPlace+=pp; x.r.querySelector('.win').value=wp.toFixed(1); x.r.querySelector('.place').value=pp.toFixed(1); x.r.querySelector('.ev').value=ev!==null?ev.toFixed(1):''; x.r.querySelector('.sim-result').innerHTML=`<strong>${badge} Sim勝率 ${wp.toFixed(1)}% / 複勝率 ${pp.toFixed(1)}%</strong><span>平均 ${formatRaceTime(avg)}${ev!==null?` / 期待回収率 ${ev.toFixed(1)}%`:''}</span>`;}); renderValueRanking(); renderAllAiBreakdowns();
  const now=new Date().toISOString(); const el=$('simulationSummary');
  el.textContent=`6,000回実行済み｜勝率合計 ${totalWin.toFixed(1)}%・複勝率合計 ${totalPlace.toFixed(1)}%｜標準 ${(probs[0]/sum*100).toFixed(0)}%・ハイ ${(probs[1]/sum*100).toFixed(0)}%・スロー ${(probs[2]/sum*100).toFixed(0)}%`;
  Object.assign(el.dataset,{runs:'6000',executedAt:now,normal:String(probs[0]/sum*100),high:String(probs[1]/sum*100),slow:String(probs[2]/sum*100)});
  return true;
}
function formatRaceTime(s){if(!Number.isFinite(s))return '—';const m=Math.floor(s/60),sec=s-m*60;return m?`${m}:${sec.toFixed(1).padStart(4,'0')}`:`${sec.toFixed(1)}秒`;}


function impliedProbability(odds){
  const o=num(odds); return o&&o>0?100/o:null;
}
function valueAssessment(win,place,odds,pop){
  const o=num(odds), p=num(pop), w=num(win), pl=num(place);
  const implied=o&&o>0?100/o:null;
  const ev=(o&&w!==null)?w*o:null;
  const gap=(implied!==null&&w!==null)?w-implied:null;
  let badge='—', tone='neutral', reason='オッズまたは人気未設定';
  if(o&&w!==null){
    badge='適正圏'; reason=`期待回収率 ${ev.toFixed(1)}%`;
    if(p!==null && p>=10 && pl!==null && pl>=25 && ev>=115){badge='💎💎💎 大穴';tone='diamond3';reason=`${p}人気想定・複勝率${pl.toFixed(1)}%・期待${ev.toFixed(1)}%`;}
    else if(p!==null && p>=7 && pl!==null && pl>=22 && ev>=110){badge='💎 穴馬';tone='diamond';reason=`${p}人気想定・複勝率${pl.toFixed(1)}%・期待${ev.toFixed(1)}%`;}
    if(p!==null && p<=3 && ((gap!==null&&gap<=-8)||ev<80)){
      let n=1; if((gap!==null&&gap<=-15)||ev<60)n=3; else if((gap!==null&&gap<=-10)||ev<70)n=2;
      badge='⚠️'.repeat(n)+' 人気馬注意'; tone='warning'; reason=`市場勝率${implied.toFixed(1)}%に対しAI${w.toFixed(1)}% / 期待${ev.toFixed(1)}%`;
    }
  }
  return {ev,implied,gap,badge,tone,reason};
}
function renderValueRanking(){
  const rows=[...document.querySelectorAll('.horse-row')].map(r=>{
    const name=r.querySelector('.horse-name').value.trim(); if(!name)return null; const no=r.querySelector('.horse-no')?.value||'';
    const win=num(r.querySelector('.win').value), place=num(r.querySelector('.place').value), odds=num(r.querySelector('.odds').value), pop=num(r.querySelector('.pop').value);
    const v=valueAssessment(win,place,odds,pop);
    const vr=r.querySelector('.value-result');
    if(vr){vr.className='value-result '+v.tone; vr.innerHTML=`<strong>${v.badge}</strong><span>${esc(v.reason)}${v.gap!==null?` / 市場差 ${v.gap>=0?'+':''}${v.gap.toFixed(1)}pt`:''}</span>`;}
    if(v.ev!==null) r.querySelector('.ev').value=v.ev.toFixed(1);
    return {no,name,win:win??-1,place:place??-1,odds,pop, ...v};
  }).filter(Boolean);
  const ability=[...rows].filter(x=>x.win>=0).sort((a,b)=>b.win-a.win).slice(0,5);
  const value=[...rows].filter(x=>x.ev!==null).sort((a,b)=>b.ev-a.ev).slice(0,5);
  const diamonds=rows.filter(x=>x.tone==='diamond'||x.tone==='diamond3').sort((a,b)=>(b.ev??0)-(a.ev??0));
  const warnings=rows.filter(x=>x.tone==='warning').sort((a,b)=>(a.ev??999)-(b.ev??999));
  const oddsCount=rows.filter(x=>x.odds).length;
  const marketCard=$('marketCard'); if(marketCard) marketCard.hidden=!oddsCount;
  const status=$('marketStatus'); if(status){status.textContent=oddsCount?`${$('oddsType')?.value||'種別不明'} ${oddsCount}頭入力`:'オッズ未入力';}
  const rank=(arr,formatter)=>arr.length?arr.map((x,i)=>`<div class="rank-row"><span>${i+1}</span><strong>${x.no?esc(x.no)+'番 ':''}${esc(x.name)}</strong><em>${formatter(x)}</em></div>`).join(''):'<p class="muted">対象なし</p>';
  const el=$('valueRanking'); if(!el)return;
  el.innerHTML=`<div class="rank-grid"><div><h3>🏆 能力順位</h3>${rank(ability,x=>`勝率 ${x.win.toFixed(1)}%`)}</div><div><h3>💰 期待値順位</h3>${rank(value,x=>`期待 ${x.ev.toFixed(1)}%`)}</div></div><div class="rank-grid value-flags"><div><h3>💎 穴馬候補</h3>${diamonds.length?diamonds.map(x=>`<div class="flag-row"><strong>${x.badge} ${x.no?esc(x.no)+'番 ':''}${esc(x.name)}</strong><span>${esc(x.reason)}</span></div>`).join(''):'<p class="muted">条件該当なし</p>'}</div><div><h3>⚠️ 人気馬リスク</h3>${warnings.length?warnings.map(x=>`<div class="flag-row"><strong>${x.badge} ${x.no?esc(x.no)+'番 ':''}${esc(x.name)}</strong><span>${esc(x.reason)}</span></div>`).join(''):'<p class="muted">条件該当なし</p>'}</div></div>`;
}

function showView(id){ document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===id)); document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.view===id)); if(id==='dashboardView')renderDashboard(); }
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>showView(t.dataset.view));

$('addHorse').onclick=()=>addHorse();
$('runSimulation').onclick=runSimulation;
$('saveRace').onclick=saveCurrent;
$('clearForm').onclick=()=>{ if(!confirm('現在の入力内容をクリアしますか？'))return; fields.forEach(f=>$(f).value=''); setAutoOddsMeta('オッズなし',''); $('chaos').value='50'; $('simNormal').value='50'; $('simHigh').value='25'; $('simSlow').value='25'; horseList.innerHTML=''; for(let i=0;i<5;i++) addHorse(); $('raceDate').valueAsDate=new Date(); };
$('exportData').onclick=()=>{ const blob=new Blob([JSON.stringify(loadAll(),null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='chass-keiba-lab-data.json'; a.click(); URL.revokeObjectURL(a.href); };
$('importData').onchange=async e=>{const f=e.target.files?.[0]; if(!f)return; try{const data=JSON.parse(await f.text()); if(!Array.isArray(data))throw new Error(); if(!confirm(`${data.length}件のデータを読み込みます。現在の保存データと置き換えますか？`))return; saveAll(data); renderArchive(); renderDashboard(); alert('読み込みました');}catch{alert('JSONデータを読み込めませんでした');} e.target.value='';};
$('themeToggle').onclick=()=>document.body.classList.toggle('light');
$('refreshDashboard').onclick=renderDashboard;
$('oddsCheckedAt')?.addEventListener('change',renderValueRanking);
horseList.addEventListener('input',e=>{if(e.target.matches('.odds,.pop,.win,.place')){ if(e.target.matches('.odds')){const any=[...document.querySelectorAll('.odds')].some(x=>num(x.value)!==null); if(any && (!$('oddsType').value || $('oddsType').value==='オッズなし'))setAutoOddsMeta('種別不明',$('oddsCheckedAt')?.value||''); if(!any)setAutoOddsMeta('オッズなし','');} renderValueRanking();}});

$('raceDate').valueAsDate=new Date(); setAutoOddsMeta('オッズなし',''); for(let i=0;i<5;i++) addHorse(); renderArchive(); renderDashboard(); renderValueRanking(); renderAllAiBreakdowns();

// Ver.5: bulk import + assisted scoring
const V5_ALIASES={
  horseNo:['horseNo','horseNumber','馬番','馬番号'], horseName:['horseName','horse','name','馬名'], mark:['mark','印','評価'], predictedTime:['predictedTime','time','予想走破タイム','予想タイム'],
  popularity:['popularity','pop','人気','想定人気'], odds:['odds','オッズ','realOdds','currentOdds','finalOdds','predictedOdds','forecastOdds','expectedOdds','予想オッズ','実オッズ'], runningStyle:['runningStyle','style','脚質'], variance:['variance','ブレ幅'], positionFail:['positionFail','position-fail','位置取り失敗率'],
  timeIndex:['timeIndex','タイム指数'], distanceIndex:['distanceIndex','距離指数'], courseIndex:['courseIndex','コース指数'], recentIndex:['recentIndex','近走指数'],
  runTheory:['runTheory','走破理論'], paceFit:['paceFit','展開適性'], trackFit:['trackFit','馬場適性'], distanceFit:['distanceFit','距離適性'], courseFit:['courseFit','コース適性'],
  bounce:['bounce','叩き効果'], lastRaceMemory:['lastRaceMemory','前走記憶'], loadLap:['loadLap','5・7・9H負荷','579H負荷'], training:['training','調教'], draw:['draw','枠'], weight:['weight','斤量'], jockey:['jockey','騎手'],
  oddsType:['oddsType','oddsKind','odds_type','オッズ種別'], oddsCheckedAt:['oddsCheckedAt','oddsTime','oddsTimestamp','オッズ確認時刻','確認時刻'], oddsSource:['oddsSource','source','dataSource','取得元','情報源'], dataConfidence:['dataConfidence','confidence','data-confidence','データ信頼度'], reason:['reason','根拠','コメント'], category:['category','競馬区分'], raceDate:['raceDate','date','日付'], track:['track','競馬場'], raceNo:['raceNo','race','レース'], distance:['distance','距離'], chaos:['chaos','波乱度'], bias:['bias','馬場傾向'], pace:['pace','展開予測']
};
function pickAlias(obj,key){for(const k of V5_ALIASES[key]||[key]){if(obj[k]!==undefined&&obj[k]!==null&&String(obj[k]).trim()!=='')return obj[k];}return ''}
function csvParse(text){
  const rows=[]; let row=[], cell='', q=false;
  for(let i=0;i<text.length;i++){const c=text[i],n=text[i+1]; if(c==='"'){if(q&&n==='"'){cell+='"';i++;}else q=!q;} else if(c===','&&!q){row.push(cell);cell='';} else if((c==='\n'||c==='\r')&&!q){if(c==='\r'&&n==='\n')i++;row.push(cell);cell='';if(row.some(v=>String(v).trim()!==''))rows.push(row);row=[];} else cell+=c;}
  if(cell!==''||row.length){row.push(cell);if(row.some(v=>String(v).trim()!==''))rows.push(row);} if(rows.length<2)return [];
  const head=rows[0].map(x=>String(x).trim().replace(/^\uFEFF/,'')); return rows.slice(1).map(r=>Object.fromEntries(head.map((h,i)=>[h,(r[i]??'').trim()])));
}
function boundedScore(v){const n=num(v);return n===null?'':Math.max(0,Math.min(10,n)).toFixed(1).replace('.0','')}
function relativeScore(vals,v,higher=true){const arr=vals.map(x=>Number(x)).filter(Number.isFinite);const x=Number(v);if(!Number.isFinite(x)||!arr.length)return '';const lo=Math.min(...arr),hi=Math.max(...arr);if(hi===lo)return '7';let p=(x-lo)/(hi-lo);p=Math.max(0,Math.min(1,p));if(!higher)p=1-p;return Math.max(0,Math.min(10,4+p*6)).toFixed(1);}
function normalizeImportedHorse(raw,context){
  const direct={}; Object.keys(LOGICS).forEach(k=>direct[k]=boundedScore(pickAlias(raw,k)));
  if(!direct.runTheory){const ts=parseTime(pickAlias(raw,'predictedTime')); direct.runTheory=ts===null?'':relativeScore(context.times,ts,false);}
  if(!direct.timeIndex){const vals=[pickAlias(raw,'timeIndex'),pickAlias(raw,'recentIndex')].map(num).filter(v=>v!==null);if(vals.length){const avg=vals.reduce((a,b)=>a+b,0)/vals.length;direct.timeIndex=relativeScore(context.indexAverages,avg,true);}}
  if(!direct.distanceFit) direct.distanceFit=relativeScore(context.distanceIndices,pickAlias(raw,'distanceIndex'),true);
  if(!direct.courseFit) direct.courseFit=relativeScore(context.courseIndices,pickAlias(raw,'courseIndex'),true);
  return {'horse-no':String(pickAlias(raw,'horseNo')||'').trim(),mark:pickAlias(raw,'mark')||'△','horse-name':String(pickAlias(raw,'horseName')||'').trim(),win:'',place:'',ev:'',time:String(pickAlias(raw,'predictedTime')||'').trim(),pop:String(pickAlias(raw,'popularity')||''),odds:String(pickAlias(raw,'odds')||''),'running-style':pickAlias(raw,'runningStyle')||'先行',variance:String(pickAlias(raw,'variance')||'2.0'),'position-fail':String(pickAlias(raw,'positionFail')||'12'),'actual-time':'','data-confidence':String(pickAlias(raw,'dataConfidence')||''),reason:String(pickAlias(raw,'reason')||''),logic:direct};
}
function buildContext(rows){
  const times=rows.map(r=>parseTime(pickAlias(r,'predictedTime'))).filter(v=>v!==null), distanceIndices=rows.map(r=>pickAlias(r,'distanceIndex')), courseIndices=rows.map(r=>pickAlias(r,'courseIndex'));
  const indexAverages=rows.map(r=>{const a=[pickAlias(r,'timeIndex'),pickAlias(r,'recentIndex')].map(num).filter(v=>v!==null);return a.length?a.reduce((x,y)=>x+y,0)/a.length:null;}).filter(v=>v!==null);
  return {times,distanceIndices,courseIndices,indexAverages};
}
function normalizeOddsTypeText(v){
  const s=String(v??'').trim().toLowerCase();
  if(!s)return '';
  if(/予想|想定|forecast|predicted|expected/.test(s))return '予想オッズ';
  if(/実オッズ|実勢|確定|発売中|live|current|official|real|final/.test(s))return '実オッズ';
  if(/なし|未発売|no odds/.test(s))return 'オッズなし';
  return '';
}
function detectOddsType(rows=[],meta={}){
  // 1) explicit metadata wins
  const explicit=normalizeOddsTypeText(pickAlias(meta,'oddsType'));
  if(explicit)return explicit;
  for(const r of rows){const t=normalizeOddsTypeText(pickAlias(r,'oddsType'));if(t)return t;}
  // 2) dedicated column names
  const keys=new Set(rows.flatMap(r=>Object.keys(r||{})).map(k=>String(k).toLowerCase()));
  const hasAny=(arr)=>arr.some(k=>keys.has(k.toLowerCase()));
  if(hasAny(['predictedOdds','forecastOdds','expectedOdds','予想オッズ','想定オッズ']))return '予想オッズ';
  if(hasAny(['realOdds','currentOdds','finalOdds','実オッズ','確定オッズ']))return '実オッズ';
  // 3) status/source/time text can distinguish only when odds exist
  const hasOdds=rows.some(r=>num(pickAlias(r,'odds'))!==null);
  if(!hasOdds)return 'オッズなし';
  const clues=[pickAlias(meta,'oddsSource'),pickAlias(meta,'oddsCheckedAt'),meta.status,meta.oddsStatus,meta.salesStatus].filter(Boolean).join(' ');
  const clueType=normalizeOddsTypeText(clues);
  if(clueType)return clueType;
  // Do not guess from numeric odds alone.
  return '種別不明';
}
function detectOddsCheckedAt(rows=[],meta={}){
  const direct=pickAlias(meta,'oddsCheckedAt'); if(direct)return String(direct);
  for(const r of rows){const v=pickAlias(r,'oddsCheckedAt');if(v)return String(v);}
  return '';
}
function setAutoOddsMeta(type,checkedAt=''){
  const t=type||'オッズなし';
  if($('oddsType'))$('oddsType').value=t;
  if($('oddsCheckedAt'))$('oddsCheckedAt').value=checkedAt||'';
  const d=$('oddsTypeDisplay'); if(d){
    d.textContent=t;
    d.className='auto-odds-type '+(t==='実オッズ'?'real':t==='予想オッズ'?'predicted':t==='種別不明'?'unknown':'');
  }
}
function applyRaceMeta(meta={}){const m={category:'category',raceDate:'raceDate',track:'track',raceNo:'raceNo',distance:'distance',chaos:'chaos',bias:'bias',pace:'pace'};Object.entries(m).forEach(([target,key])=>{const v=pickAlias(meta,key);if(v!==''&&$(target))$(target).value=v;});}
function saveCurrentSilent(){
  const d=getForm(), all=loadAll();
  const idx=all.findIndex(x=>x.raceDate===d.raceDate && x.track===d.track && String(x.raceNo)===String(d.raceNo));
  if(idx>=0)all[idx]=d; else all.unshift(d);
  saveAll(all); renderArchive(); renderDashboard();
}
function runFullPipeline(autoSave=true){
  autoScoreCurrent();
  const ok=runSimulation();
  if(ok&&autoSave){saveCurrentSilent(); $('importStatus').textContent += ' 6,000回シミュレーション実行・保存まで完了しました。';}
  return ok;
}
function importRaceRows(rows,meta={}){
  if(!rows.length)throw new Error('出走馬データがありません'); const ctx=buildContext(rows); const hs=rows.map(r=>normalizeImportedHorse(r,ctx)).filter(h=>h['horse-name']); if(hs.length<2)throw new Error('馬名を2頭以上確認できませんでした');
  applyRaceMeta(Object.assign({},rows[0]||{},meta));
  const autoOddsType=detectOddsType(rows,meta), autoOddsTime=detectOddsCheckedAt(rows,meta); setAutoOddsMeta(autoOddsType,autoOddsTime);
  horseList.innerHTML=''; hs.forEach(addHorse); $('importStatus').textContent=`${hs.length}頭を一括入力しました。オッズ種別：${autoOddsType}。予想タイム・指数など確認できた項目から採点を補助しました。`;
  if($('autoRunAfterImport').checked){setTimeout(()=>runFullPipeline(true),0);} return hs.length;
}
function cleanJsonText(text){
  let t=String(text??'').replace(/^\uFEFF/,'').trim();
  if(!t)throw new Error('JSONが空です。ファイル全体を選択してください。');
  if(t.startsWith('```')){t=t.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();}
  return t;
}
function jsonStructureHint(t){
  const opens=(t.match(/[\[{]/g)||[]).length, closes=(t.match(/[\]}]/g)||[]).length;
  if(opens>closes)return `JSONの末尾が不足している可能性があります（開始記号${opens} / 終了記号${closes}）。コピー途中切れを確認してください。`;
  if(closes>opens)return `JSONの閉じ記号が多すぎます（開始記号${opens} / 終了記号${closes}）。`;
  const last=t.slice(-1); if(last!=='}'&&last!==']')return 'JSONの末尾が } または ] で終わっていません。途中で切れている可能性があります。';
  return '';
}
function parseRaceJson(text){
  const t=cleanJsonText(text); let d;
  try{d=JSON.parse(t);}catch(e){const hint=jsonStructureHint(t);throw new Error(hint||`JSON構文エラー：${e.message}`);}
  if(Array.isArray(d)){if(d[0]?.horses)throw new Error('これは保存バックアップJSONです。レース一括取込ではなく下部の「JSONを読み込み」を使用してください。');return {rows:d,meta:{}};}
  if(d&&Array.isArray(d.horses))return {rows:d.horses,meta:d.race||d.meta||d};
  throw new Error('horses配列を確認できませんでした。チャス競馬研究所用JSONか確認してください。');
}
function validateRaceJson(text){const {rows}=parseRaceJson(text);if(rows.length<2)throw new Error('出走馬が2頭未満です。');return `${rows.length}頭のJSONを確認しました。形式は正常です。`;}
async function importJsonFile(file){
  if(!file)return; const text=await file.text(); const {rows,meta}=parseRaceJson(text); const n=importRaceRows(rows,meta); $('importStatus').textContent=`${file.name}：${n}頭を正常に取り込みました。`;
}
function autoScoreCurrent(){
  const rows=[...document.querySelectorAll('.horse-row')], times=rows.map(r=>parseTime(r.querySelector('.time').value)); const valid=times.filter(v=>v!==null); let changed=0;
  rows.forEach((r,i)=>{const timeEl=r.querySelector('[data-logic="runTheory"]');if(timeEl&&!timeEl.value&&times[i]!==null){timeEl.value=relativeScore(valid,times[i],false);changed++;}updateLogicAverage(r);});
  $('importStatus').textContent=`現在の入力を採点補助しました（${changed}項目更新）。未入力の適性・調教等は根拠データがないため自動補完していません。`; return changed;
}
$('chassJsonFile').onchange=async e=>{const f=e.target.files?.[0];if(!f)return;try{await importJsonFile(f);}catch(err){$('importStatus').textContent='取込失敗：'+(err.message||'JSONを確認してください');alert($('importStatus').textContent)}e.target.value='';};
$('raceImportFile').onchange=async e=>{const f=e.target.files?.[0];if(!f)return;try{const text=await f.text();const name=f.name.toLowerCase();const trimmed=text.replace(/^\uFEFF/,'').trim();const looksJson=name.endsWith('.json')||trimmed.startsWith('{')||trimmed.startsWith('[');if(looksJson){const {rows,meta}=parseRaceJson(text);const n=importRaceRows(rows,meta);$('importStatus').textContent=`✓ ${n}頭読込・採点・6,000回Sim・保存完了`;}else{const rows=csvParse(text);const n=importRaceRows(rows,{});$('importStatus').textContent=`✓ ${n}頭読込・採点・6,000回Sim・保存完了`;}}catch(err){$('importStatus').textContent='取込失敗：'+(err.message||'JSON / CSV形式を確認してください');alert($('importStatus').textContent)}e.target.value='';};
$('validatePastedJson').onclick=()=>{try{$('importStatus').textContent=validateRaceJson($('raceJsonPaste').value);}catch(err){$('importStatus').textContent='事前チェック：'+(err.message||'JSONを確認してください');}};
$('importPastedJson').onclick=()=>{try{const {rows,meta}=parseRaceJson($('raceJsonPaste').value);importRaceRows(rows,meta);}catch(err){$('importStatus').textContent='取込失敗：'+(err.message||'JSONを確認してください');alert($('importStatus').textContent)}};
$('autoScoreCurrent').onclick=autoScoreCurrent;
$('oneTapAnalyze').onclick=()=>runFullPipeline(true);
$('downloadCsvTemplate').onclick=()=>{const csv='category,raceDate,track,raceNo,distance,chaos,oddsType,oddsCheckedAt,horseNo,horseName,mark,predictedTime,popularity,odds,runningStyle,timeIndex,distanceIndex,courseIndex,recentIndex,runTheory,paceFit,trackFit,distanceFit,courseFit,bounce,lastRaceMemory,loadLap,training,draw,weight,jockey,dataConfidence,reason\n地方競馬,2026-08-27,船橋,11,1200,65,予想オッズ,発売前,1,サンプルA,◎,1:14.2,2,4.8,先行,82,84,80,81,,,,,,,,,,,,,\n地方競馬,2026-08-27,船橋,11,1200,65,予想オッズ,発売前,2,サンプルB,💎,1:14.5,8,18.5,差し,78,80,76,79,,,,,,,,,,,,,';const blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='chass-keiba-import-template.csv';a.click();URL.revokeObjectURL(a.href);};

// Ver.5.8 compact fact summary
function compactFactText(s,max=58){s=(s||'').replace(/\s+/g,' ').replace(/^確認事実[:：]?\s*/,'').trim();return s.length>max?s.slice(0,max-1)+'…':s;}
function updateFactSummary(row){
  const h=horseFromRow(row), raw=(h.reason||'').trim();
  const set=(sel,v)=>{const e=row.querySelector(sel);if(e)e.textContent=v||'—';};
  if(!raw){set('.fact-plus','—');set('.fact-minus','—');set('.fact-unknown','データ不足');return;}
  const parts=raw.split(/[。；;\n]+/).map(x=>x.trim()).filter(Boolean);
  const plus=parts.filter(x=>/(1着|2着|3着|好走|実績あり|最高|安定|連対|勝利|上位)/.test(x));
  const minus=parts.filter(x=>/(休養|着外|不振|失敗|リスク|初出走|転入|ブレ|高不確実|不利)/.test(x));
  const unk=parts.filter(x=>/(確認できず|不明|未確認|暫定|直接比較不可|実績は確認できず)/.test(x));
  set('.fact-plus',compactFactText((plus[0]||parts[0]||'')));
  set('.fact-minus',compactFactText(minus[0]||''));
  set('.fact-unknown',compactFactText(unk[0]||''));
}
const _oldRefreshCompactSummary=refreshCompactSummary;
refreshCompactSummary=function(row,allHorses){_oldRefreshCompactSummary(row,allHorses);updateFactSummary(row);};

// Ver.5.8: single-file import is always full-auto.
document.addEventListener('DOMContentLoaded',()=>{const a=document.getElementById('autoRunAfterImport');if(a)a.checked=true;});

// Ver.5.8 compact race overview
(function(){
  const ids=['category','raceDate','track','raceNo','distance','chaos','bias','pace'];
  function val(id){ const e=document.getElementById(id); return e ? String(e.value||'').trim() : ''; }
  function fmtDate(s){ if(!s) return ''; const p=s.split('-'); return p.length===3 ? `${Number(p[1])}/${Number(p[2])}` : s; }
  function refreshRaceOverview(){
    const cat=val('category'), date=val('raceDate'), track=val('track'), no=val('raceNo'), dist=val('distance'), chaos=val('chaos'), bias=val('bias'), pace=val('pace');
    const title=document.getElementById('raceOverviewTitle');
    const meta=document.getElementById('raceOverviewMeta');
    const cb=document.getElementById('raceChaosBadge');
    const pb=document.getElementById('racePaceBadge');
    const bb=document.getElementById('raceOverviewBias');
    if(title) title.textContent = (track||'競馬場未入力') + (no ? ` ${no}R` : '');
    const bits=[]; if(date) bits.push(fmtDate(date)); if(cat) bits.push(cat); if(dist) bits.push(`${dist}m`);
    if(meta) meta.textContent = bits.length ? bits.join(' ｜ ') : 'ファイルを読み込むと自動表示します。';
    if(cb) cb.textContent = chaos ? `波乱度 ${chaos}%` : '波乱度 —';
    if(pb) pb.textContent = pace ? `展開 ${pace}` : '展開 —';
    if(bb) bb.textContent = `馬場：${bias||'未確認'}`;
  }
  function bind(){
    ids.forEach(id=>{ const e=document.getElementById(id); if(e){ e.addEventListener('input',refreshRaceOverview); e.addEventListener('change',refreshRaceOverview); }});
    refreshRaceOverview();
    new MutationObserver(()=>setTimeout(refreshRaceOverview,0)).observe(document.body,{childList:true,subtree:true});
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',bind); else bind();
})();

/* === Integrated Ver.7.5 features === */
// CHASS KEIBA LAB Ver.7.5 patch
// 目的:
// 1) CHASS FINAL（最終判断）を最上部に追加
// 2) 期待値・穴馬・人気馬リスクを見やすく統合
// 3) AI勝率 / 総合評価 / 期待値モデルを分離して保存・検証
// 4) ダッシュボードで回収率・平均人気・モデル比較を追加
// 5) 既存 Ver.7.4 を壊さず後読みで拡張

(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const qsa = (s, root=document) => [...root.querySelectorAll(s)];
  const num = v => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };
  const clamp = (v, lo=0, hi=100) => Math.max(lo, Math.min(hi, v));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  }[m]));

  // ----------------------------
  // 0. Version / style
  // ----------------------------
  function setVersion75(){
    document.title = document.title.replace(/Ver\.\d+(?:\.\d+)?/i, 'Ver.7.5');
    const h1 = document.querySelector('.topbar h1');
    if(h1){
      const span = h1.querySelector('span');
      if(span) span.textContent = 'Ver.7.5';
    }
  }

  function injectStyles(){
    if($('chass75Styles')) return;
    const st = document.createElement('style');
    st.id = 'chass75Styles';
    st.textContent = `
      .chass-final-card{border:1px solid rgba(90,229,188,.42);background:linear-gradient(180deg,rgba(16,34,55,.98),rgba(12,27,46,.98));}
      .chass-final-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px}
      .chass-final-title{font-size:1.55rem;font-weight:800;letter-spacing:.01em}
      .chass-final-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:14px 0}
      .chass-final-pick{border:1px solid rgba(130,160,205,.22);border-radius:16px;padding:14px;background:rgba(255,255,255,.025)}
      .chass-final-pick strong{display:block;font-size:1.05rem;margin-bottom:6px}
      .chass-final-pick small{display:block;opacity:.78;line-height:1.55}
      .chass-final-flags{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px}
      .chass-final-flag{border-radius:14px;padding:12px 14px;background:rgba(255,255,255,.03);border:1px solid rgba(130,160,205,.18);line-height:1.5}
      .chass-final-flag.diamond{border-color:rgba(92,224,207,.45)}
      .chass-final-flag.warning{border-color:rgba(255,194,88,.45)}
      .chass-final-meta{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
      .model-tag{display:inline-flex;align-items:center;border-radius:999px;padding:5px 9px;font-size:.78rem;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08)}
      .chass75-value{font-weight:800}
      .chass75-value.good{color:#61e7bd}
      .chass75-value.hot{color:#7bf0d0}
      .chass75-value.bad{color:#ffc66d}
      .dash-extra-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
      .dash-extra-card{border:1px solid rgba(130,160,205,.18);border-radius:16px;padding:14px;background:rgba(255,255,255,.025)}
      .dash-extra-card strong{font-size:1.35rem;display:block;margin:5px 0}
      .model-compare-table td,.model-compare-table th{white-space:nowrap}
      @media(max-width:700px){
        .chass-final-grid{grid-template-columns:1fr}
        .chass-final-flags{grid-template-columns:1fr}
        .dash-extra-grid{grid-template-columns:1fr}
      }
    `;
    document.head.appendChild(st);
  }

  // ----------------------------
  // 1. Utility: horse snapshot
  // ----------------------------
  function horseRows(){
    return qsa('.horse-row').filter(r => r.querySelector('.horse-name')?.value.trim());
  }

  function currentHorseData(){
    const rows = horseRows();
    const hs = rows.map((r, i) => {
      let h = null;
      try{
        h = typeof horseFromRow === 'function' ? horseFromRow(r) : null;
      }catch{}
      if(!h){
        h = {
          'horse-no': r.querySelector('.horse-no')?.value || String(i+1),
          mark: r.querySelector('.mark')?.value || '',
          'horse-name': r.querySelector('.horse-name')?.value.trim() || '',
          win: r.querySelector('.win')?.value || '',
          place: r.querySelector('.place')?.value || '',
          ev: r.querySelector('.ev')?.value || '',
          odds: r.querySelector('.odds')?.value || '',
          pop: r.querySelector('.pop')?.value || '',
          time: r.querySelector('.time')?.value || ''
        };
      }
      let overall = 50, confidence = 0;
      try{
        if(typeof aiBreakdown === 'function'){
          overall = aiBreakdown(h, rows.map(rr => typeof horseFromRow==='function'?horseFromRow(rr):h))?.overall ?? overall;
        }
      }catch{}
      try{
        if(typeof derivedConfidence === 'function') confidence = derivedConfidence(h);
      }catch{}
      const win = num(h.win), place = num(h.place), odds = num(h.odds), pop = num(h.pop), ev = num(h.ev);
      const fair = win && win > 0 ? 100 / win : null;
      const expected = odds && win !== null ? odds * win : ev;
      return {
        row:r, no:String(h['horse-no']||i+1), name:h['horse-name']||'',
        mark:h.mark||'', win, place, odds, pop, ev: expected,
        fair, time:h.time||'', overall:Number(overall)||50, confidence:Number(confidence)||0
      };
    });
    return hs;
  }

  function abilityRank(hs){
    return [...hs].sort((a,b)=>(b.win??-1)-(a.win??-1));
  }
  function overallRank(hs){
    return [...hs].sort((a,b)=>(b.overall??-1)-(a.overall??-1));
  }
  function valueRank(hs){
    return [...hs].filter(x=>x.ev!==null).sort((a,b)=>(b.ev??-1)-(a.ev??-1));
  }

  function finalScore(x, hs){
    const aRank = abilityRank(hs).findIndex(h=>h===x);
    const oRank = overallRank(hs).findIndex(h=>h===x);
    const vRank = valueRank(hs).findIndex(h=>h===x);
    const n = Math.max(1, hs.length);
    const rankScore = (r, w) => r < 0 ? 0 : ((n-r)/n)*w;
    // 勝率・総合評価・複勝率・期待値・信頼度を分離して統合
    let s = 0;
    s += rankScore(aRank, 34);
    s += rankScore(oRank, 25);
    s += (x.place ?? 0) * 0.16;
    s += (x.confidence ?? 0) * 0.10;
    if(x.ev !== null) s += clamp((x.ev-70)/80*15, -5, 15);
    return s;
  }

  function pickFinal(hs){
    return [...hs].sort((a,b)=>finalScore(b,hs)-finalScore(a,hs));
  }

  function holeCandidates(hs){
    return hs.filter(x=>{
      if(x.ev===null) return false;
      if(x.pop!==null && x.pop>=8 && (x.place??0)>=18 && x.ev>=125) return true;
      if(x.pop!==null && x.pop>=4 && (x.place??0)>=20 && x.ev>=112) return true;
      return false;
    }).sort((a,b)=>(b.ev??0)-(a.ev??0));
  }

  function warningCandidates(hs){
    return hs.filter(x=>{
      if(x.ev===null || x.pop===null || x.pop>3) return false;
      return x.ev < 82;
    }).sort((a,b)=>(a.ev??999)-(b.ev??999));
  }

  // ----------------------------
  // 2. CHASS FINAL
  // ----------------------------
  function ensureFinalCard(){
    let card = $('chassFinalCard');
    if(card) return card;
    const raceCard = document.querySelector('.race-overview-card');
    if(!raceCard) return null;
    card = document.createElement('section');
    card.id = 'chassFinalCard';
    card.className = 'card chass-final-card';
    card.innerHTML = `
      <div class="chass-final-head">
        <div><p class="eyebrow">CHASS FINAL</p><div class="chass-final-title">最終判断</div></div>
        <span class="badge" id="chassFinalStatus">分析待ち</span>
      </div>
      <div id="chassFinalBody"><p class="muted">予想データを読み込むと自動表示します。</p></div>
    `;
    raceCard.insertAdjacentElement('afterend', card);
    return card;
  }

  function renderFinal(){
    const card = ensureFinalCard();
    if(!card) return;
    const body = $('chassFinalBody');
    const status = $('chassFinalStatus');
    const hs = currentHorseData();
    if(!hs.length){
      body.innerHTML = '<p class="muted">予想データを読み込むと自動表示します。</p>';
      if(status) status.textContent = '分析待ち';
      return;
    }

    const picks = pickFinal(hs).slice(0,3);
    const marks = ['◎','○','▲'];
    const diamonds = holeCandidates(hs);
    const warnings = warningCandidates(hs);
    const chaos = num($('chaos')?.value);
    const pace = $('pace')?.value?.trim() || '未設定';

    const cards = picks.map((x,i)=>{
      const ev = x.ev===null ? '市場待ち' : `${x.ev.toFixed(0)}%`;
      const fair = x.fair ? `${x.fair.toFixed(1)}倍` : '—';
      return `<div class="chass-final-pick">
        <strong>${marks[i]} ${esc(x.no)}番 ${esc(x.name)}</strong>
        <small>勝 ${x.win===null?'—':x.win.toFixed(1)+'%'} ｜ 複 ${x.place===null?'—':x.place.toFixed(1)+'%'}<br>
        総合 ${x.overall.toFixed(0)}/100 ｜ 期待 ${ev} ｜ AIフェア ${fair}</small>
      </div>`;
    }).join('');

    const d = diamonds[0];
    const w = warnings[0];
    const diamondText = d
      ? `${(d.pop??99)>=10 && (d.ev??0)>=135 ? '💎💎💎 激推し大穴' : '💎 穴馬'}：${esc(d.no)}番 ${esc(d.name)} ｜ 期待 ${d.ev.toFixed(0)}%${d.pop?` ｜ ${d.pop}人気`:''}`
      : '💎 穴馬：現時点で強い市場乖離なし';
    const warnText = w
      ? `⚠️ 人気馬注意：${esc(w.no)}番 ${esc(w.name)} ｜ 期待 ${w.ev.toFixed(0)}%${w.pop?` ｜ ${w.pop}人気`:''}`
      : '⚠️ 人気馬リスク：強い該当なし';

    body.innerHTML = `
      <div class="chass-final-grid">${cards}</div>
      <div class="chass-final-flags">
        <div class="chass-final-flag diamond">${diamondText}</div>
        <div class="chass-final-flag warning">${warnText}</div>
      </div>
      <div class="chass-final-meta">
        <span class="model-tag">波乱度 ${chaos===null?'—':chaos+'%'}</span>
        <span class="model-tag">展開 ${esc(pace)}</span>
        <span class="model-tag">勝率モデル・総合モデル・期待値モデルを分離</span>
      </div>
    `;
    if(status) status.textContent = hs.some(x=>x.odds) ? '市場反映済' : 'AI評価';
  }

  // ----------------------------
  // 3. 自動印を「最終判断」に合わせる
  // ----------------------------
  function assignFinalMarks(){
    const hs = currentHorseData();
    if(!hs.length) return;
    const picks = pickFinal(hs);
    hs.forEach(x=>{
      const sel = x.row.querySelector('.mark');
      if(sel) sel.value = '';
    });
    ['◎','○','▲'].forEach((m,i)=>{
      const x = picks[i];
      if(x?.row?.querySelector('.mark')) x.row.querySelector('.mark').value = m;
    });
  }

  // ----------------------------
  // 4. 保存時にモデル別順位を記録
  // ----------------------------
  function modelSnapshot(){
    const hs = currentHorseData();
    const top = arr => arr[0] ? {horseNo:arr[0].no,horseName:arr[0].name} : null;
    return {
      savedAt:new Date().toISOString(),
      winModelTop:top(abilityRank(hs)),
      overallModelTop:top(overallRank(hs)),
      valueModelTop:top(valueRank(hs)),
      finalModelTop:top(pickFinal(hs))
    };
  }

  if(typeof getForm === 'function'){
    const oldGetForm = getForm;
    window.getForm = function(){
      const d = oldGetForm();
      d.modelSnapshot = modelSnapshot();
      return d;
    };
  }

  // ----------------------------
  // 5. Dashboard extras
  // ----------------------------
  function raceResults(r){
    return [r.result1,r.result2,r.result3].map(x=>String(x||'').trim()).filter(Boolean);
  }
  function pos(r,h){
    const rs = raceResults(r);
    const no = String(h['horse-no']||'').trim();
    const i = rs.indexOf(no);
    return i>=0 ? i+1 : null;
  }

  function ensureDashboardExtras(){
    const dash = $('dashboardView');
    if(!dash || $('dashValueValidation')) return;

    const sec = document.createElement('section');
    sec.id = 'dashValueValidation';
    sec.className = 'card dash-data-section';
    sec.innerHTML = `
      <div class="section-head"><div><p class="eyebrow">VALUE VALIDATION</p><h2>穴馬・危険馬・回収率</h2></div></div>
      <div id="dashValueValidationBody" class="dash-extra-grid"></div>
    `;
    dash.appendChild(sec);

    const sec2 = document.createElement('section');
    sec2.id = 'dashModelCompare';
    sec2.className = 'card dash-data-section';
    sec2.innerHTML = `
      <div class="section-head"><div><p class="eyebrow">MODEL COMPARISON</p><h2>モデル別トップ評価の成績</h2></div></div>
      <div class="table-wrap"><table class="model-compare-table">
        <thead><tr><th>モデル</th><th>対象</th><th>1着</th><th>3着内</th><th>勝率</th><th>複勝率</th></tr></thead>
        <tbody id="dashModelCompareBody"></tbody>
      </table></div>
    `;
    dash.appendChild(sec2);
  }

  function calcValueStats(all){
    let dN=0,dPlace=0,dWin=0,dPop=0,dPopN=0,dReturn=0;
    let wN=0,wOut=0;
    all.filter(r=>raceResults(r).length).forEach(r=>{
      (r.horses||[]).forEach(h=>{
        const pop=num(h.pop), ev=num(h.ev), odds=num(h.odds), place=num(h.place);
        const p=pos(r,h);
        const isD = (String(h.mark||'').includes('💎')) ||
          (pop!==null && ev!==null && ((pop>=8 && place>=18 && ev>=125)||(pop>=4 && place>=20 && ev>=112)));
        if(isD){
          dN++;
          if(p===1)dWin++;
          if(p&&p<=3)dPlace++;
          if(pop!==null){dPop+=pop;dPopN++;}
          if(p===1 && odds!==null)dReturn += odds*100;
        }
        const isW = String(h.mark||'').includes('⚠️') || (pop!==null&&pop<=3&&ev!==null&&ev<82);
        if(isW){
          wN++;
          if(!p || p>3)wOut++;
        }
      });
    });
    return {
      dN,dWin,dPlace,avgPop:dPopN?dPop/dPopN:null,
      winReturn:dN?dReturn/dN:null,
      wN,wOut
    };
  }

  function modelStats(all, key){
    let n=0,win=0,place=0;
    all.filter(r=>raceResults(r).length).forEach(r=>{
      const snap=r.modelSnapshot?.[key];
      if(!snap?.horseNo)return;
      const h=(r.horses||[]).find(x=>String(x['horse-no'])===String(snap.horseNo));
      if(!h)return;
      n++;
      const p=pos(r,h);
      if(p===1)win++;
      if(p&&p<=3)place++;
    });
    return {n,win,place};
  }

  function pct(a,b){ return b ? (a/b*100).toFixed(1)+'%' : '—'; }

  function renderDashboardExtras(){
    ensureDashboardExtras();
    let all=[];
    try{ all = typeof loadAll === 'function' ? loadAll() : []; }catch{}
    const v=calcValueStats(all);
    const body=$('dashValueValidationBody');
    if(body){
      body.innerHTML = `
        <div class="dash-extra-card"><span>💎 穴馬 指名数</span><strong>${v.dN}頭</strong><small>勝 ${pct(v.dWin,v.dN)} / 複 ${pct(v.dPlace,v.dN)}</small></div>
        <div class="dash-extra-card"><span>💎 平均人気</span><strong>${v.avgPop===null?'—':v.avgPop.toFixed(1)+'人気'}</strong><small>保存データ内の人気</small></div>
        <div class="dash-extra-card"><span>💎 単勝回収率</span><strong>${v.winReturn===null?'—':v.winReturn.toFixed(1)+'%'}</strong><small>単勝オッズ保存済み馬のみ概算</small></div>
        <div class="dash-extra-card"><span>⚠️ 人気馬 圏外率</span><strong>${pct(v.wOut,v.wN)}</strong><small>${v.wN}頭中 ${v.wOut}頭</small></div>
      `;
    }

    const models=[
      ['winModelTop','勝率モデル'],
      ['overallModelTop','総合評価モデル'],
      ['valueModelTop','期待値モデル'],
      ['finalModelTop','CHASS FINAL']
    ];
    const tb=$('dashModelCompareBody');
    if(tb){
      tb.innerHTML=models.map(([k,label])=>{
        const s=modelStats(all,k);
        return `<tr><td><strong>${label}</strong></td><td>${s.n}</td><td>${s.win}</td><td>${s.place}</td><td>${pct(s.win,s.n)}</td><td>${pct(s.place,s.n)}</td></tr>`;
      }).join('');
    }
  }

  // ----------------------------
  // 6. Existing function hooks
  // ----------------------------
  function hook(name, after){
    const fn = window[name];
    if(typeof fn !== 'function') return;
    if(fn.__chass75Hooked) return;
    const wrapped = function(...args){
      const out = fn.apply(this,args);
      try{ after(...args); }catch(e){ console.warn('Ver.7.5 hook',name,e); }
      return out;
    };
    wrapped.__chass75Hooked = true;
    window[name] = wrapped;
  }

  function hookAsync(name, after){
    const fn = window[name];
    if(typeof fn !== 'function') return;
    if(fn.__chass75Hooked) return;
    const wrapped = async function(...args){
      const out = await fn.apply(this,args);
      try{ await after(...args); }catch(e){ console.warn('Ver.7.5 hook',name,e); }
      return out;
    };
    wrapped.__chass75Hooked = true;
    window[name] = wrapped;
  }

  function installHooks(){
    hook('renderAllAiBreakdowns',()=>renderFinal());
    hook('renderValueRanking',()=>renderFinal());
    hook('renderDashboard',()=>renderDashboardExtras());
    hook('saveCurrentSilent',()=>renderDashboardExtras());
    hook('saveCurrent',()=>renderDashboardExtras());

    const oldSim = window.runSimulation;
    if(typeof oldSim==='function' && !oldSim.__chass75Hooked){
      const wrapped=function(...args){
        const ok=oldSim.apply(this,args);
        if(ok){
          try{ assignFinalMarks(); }catch{}
          try{ if(typeof renderValueRanking==='function') renderValueRanking(); }catch{}
          try{ renderFinal(); }catch{}
        }
        return ok;
      };
      wrapped.__chass75Hooked=true;
      window.runSimulation=wrapped;
      const btn=$('runSimulation');
      if(btn) btn.onclick=window.runSimulation;
    }

    const oldApplyOdds = window.applyOfficialOdds;
    if(typeof oldApplyOdds==='function' && !oldApplyOdds.__chass75Hooked){
      const wrapped=function(...args){
        const n=oldApplyOdds.apply(this,args);
        try{
          if(typeof renderValueRanking==='function') renderValueRanking();
          assignFinalMarks();
          renderFinal();
        }catch{}
        return n;
      };
      wrapped.__chass75Hooked=true;
      window.applyOfficialOdds=wrapped;
    }

    hookAsync('fetchOfficialNar',async()=> {
      try{
        if(typeof renderValueRanking==='function') renderValueRanking();
        assignFinalMarks();
        renderFinal();
        renderDashboardExtras();
      }catch{}
    });
  }

  // ----------------------------
  // 7. Mutation observer for imported data
  // ----------------------------
  let t=null;
  function scheduleRefresh(){
    clearTimeout(t);
    t=setTimeout(()=>{
      try{ renderFinal(); }catch{}
      try{ renderDashboardExtras(); }catch{}
    },120);
  }

  function init(){
    setVersion75();
    injectStyles();
    ensureFinalCard();
    installHooks();
    renderFinal();
    ensureDashboardExtras();
    renderDashboardExtras();

    document.addEventListener('input', e=>{
      if(e.target?.matches?.('.win,.place,.odds,.pop,.mark,.horse-name,.horse-no,#chaos,#pace')) scheduleRefresh();
    });
    document.addEventListener('change', e=>{
      if(e.target?.matches?.('.win,.place,.odds,.pop,.mark,.horse-name,.horse-no,#chaos,#pace')) scheduleRefresh();
    });

    const root=$('horseList');
    if(root){
      new MutationObserver(scheduleRefresh).observe(root,{childList:true,subtree:true});
    }

    // タブ切替後にモデル比較を再描画
    qsa('.tab').forEach(btn=>btn.addEventListener('click',()=>setTimeout(renderDashboardExtras,60)));
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',init);
  }else{
    init();
  }
})();

/* === Integrated Ver.7.6 features === */
/* CHASS KEIBA LAB Ver.7.6 patch
   Goals:
   1) AI fair odds / real odds / expected return are strictly separated.
   2) Market snapshots are preserved per race.
   3) Dashboard tables are mobile-friendly.
   4) No "expected return" is shown as confirmed unless real odds are available.
*/
(() => {
  'use strict';

  const VERSION = '7.6';
  const SNAP_KEY = 'chass_market_snapshots_v76';

  const $v76 = (id) => document.getElementById(id);
  const n76 = (v) => {
    const x = parseFloat(v);
    return Number.isFinite(x) ? x : null;
  };
  const esc76 = (s='') => String(s).replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  }[m]));

  function raceKey76() {
    const d = String($v76('raceDate')?.value || '');
    const t = String($v76('track')?.value || '');
    const r = String($v76('raceNo')?.value || '');
    return `${d}|${t}|${r}`;
  }

  function loadSnaps76() {
    try { return JSON.parse(localStorage.getItem(SNAP_KEY) || '{}'); }
    catch { return {}; }
  }
  function saveSnaps76(v) {
    localStorage.setItem(SNAP_KEY, JSON.stringify(v));
  }

  function currentHorseMarket76() {
    return [...document.querySelectorAll('.horse-row')]
      .map((row, i) => {
        let h = null;
        try { h = horseFromRow(row); } catch {}
        if (!h) return null;
        const name = String(h['horse-name'] || '').trim();
        if (!name) return null;
        const win = n76(h.win), place = n76(h.place), odds = n76(h.odds), pop = n76(h.pop);
        const fair = win && win > 0 ? 100 / win : null;
        return {
          no: String(h['horse-no'] || i + 1),
          name,
          mark: h.mark || '',
          win, place, odds, pop, fair
        };
      }).filter(Boolean);
  }

  function marketKind76() {
    const t = String($v76('oddsType')?.value || '').trim();
    if (t === '実オッズ') return 'real';
    if (t === '予想オッズ') return 'predicted';
    if (t === '種別不明') return 'unknown';
    return 'none';
  }

  function captureSnapshot76(source='ui') {
    const horses = currentHorseMarket76();
    if (!horses.length || !horses.some(h => h.odds && h.odds > 0)) return;
    const key = raceKey76();
    if (!key || key === '||') return;

    const db = loadSnaps76();
    db[key] ||= [];
    const kind = marketKind76();
    const checkedAt = String($v76('oddsCheckedAt')?.value || '');
    const sig = JSON.stringify(horses.map(h => [h.no, h.odds, h.pop]));
    const last = db[key][db[key].length - 1];
    if (last && last.sig === sig && last.kind === kind && last.checkedAt === checkedAt) return;

    db[key].push({
      at: new Date().toISOString(),
      source,
      kind,
      oddsType: String($v76('oddsType')?.value || ''),
      checkedAt,
      horses: horses.map(h => ({ no:h.no, name:h.name, odds:h.odds, pop:h.pop })),
      sig
    });
    if (db[key].length > 40) db[key] = db[key].slice(-40);
    saveSnaps76(db);
  }

  function getSnapshotPair76() {
    const list = loadSnaps76()[raceKey76()] || [];
    const priced = list.filter(x => (x.horses || []).some(h => h.odds));
    if (!priced.length) return { first:null, final:null, latest:null };

    const firstReal = priced.find(x => x.kind === 'real') || null;
    const finalReal = [...priced].reverse().find(x =>
      x.kind === 'real' && (/最終/.test(x.checkedAt || '') || x.source === 'official-final')
    ) || null;
    return {
      first: firstReal || priced[0],
      final: finalReal,
      latest: priced[priced.length - 1]
    };
  }

  function valueLabel76(h, kind) {
    if (!h.fair) return { main:'AIフェア —', sub:'AI勝率未計算', cls:'' };
    if (kind !== 'real' || !h.odds) {
      const src = kind === 'predicted' ? '予想オッズ' : kind === 'unknown' ? '種別不明オッズ' : '市場未取得';
      return {
        main:`AIフェア ${h.fair.toFixed(1)}倍`,
        sub:`実オッズ — ｜ 期待回収率 —（${src}）`,
        cls:''
      };
    }
    const ev = h.win * h.odds;
    const gap = h.odds / h.fair;
    let cls = '', tag = '適正圏';
    if (ev >= 125 && (h.pop ?? 0) >= 8 && (h.place ?? 0) >= 18) { cls='v76-diamond3'; tag='💎💎💎 大穴'; }
    else if (ev >= 110 && (h.pop ?? 0) >= 4) { cls='v76-diamond'; tag='💎 期待値'; }
    else if (ev < 82 && (h.pop ?? 99) <= 3) { cls='v76-warning'; tag='⚠️ 人気馬注意'; }

    return {
      main:`${tag} ｜ 期待回収率 ${ev.toFixed(0)}%`,
      sub:`実 ${h.odds.toFixed(1)}倍 ｜ AIフェア ${h.fair.toFixed(1)}倍 ｜ 市場/AI ${gap.toFixed(2)}x`,
      cls
    };
  }

  function ensureMarketCard76() {
    let card = $v76('v76MarketDiscipline');
    if (card) return card;

    card = document.createElement('section');
    card.id = 'v76MarketDiscipline';
    card.className = 'card v76-market-card';
    card.innerHTML = `
      <div class="section-head">
        <div><p class="eyebrow">MARKET CHECK</p><h2>AIフェア・実オッズ・期待回収率</h2></div>
        <span id="v76MarketBadge" class="badge">市場待ち</span>
      </div>
      <div class="v76-market-note">
        AIフェア倍率と実オッズを分離表示します。期待回収率は「実オッズ」と確認できた場合だけ確定表示します。
      </div>
      <div id="v76MarketRows" class="v76-market-list"></div>
      <div id="v76SnapshotInfo" class="muted v76-snapshot-info"></div>
    `;

    const finalCard = [...document.querySelectorAll('section.card')].find(x =>
      /最終判断/.test(x.textContent || '')
    );
    const quick = document.querySelector('.quick-card');
    if (finalCard?.parentNode) finalCard.insertAdjacentElement('afterend', card);
    else if (quick?.parentNode) quick.insertAdjacentElement('beforebegin', card);
    else document.querySelector('#predictionView')?.prepend(card);
    return card;
  }

  function renderMarketDiscipline76() {
    const card = ensureMarketCard76();
    if (!card) return;

    const horses = currentHorseMarket76();
    const list = $v76('v76MarketRows');
    const badge = $v76('v76MarketBadge');
    const info = $v76('v76SnapshotInfo');

    if (!horses.length) {
      card.hidden = true;
      return;
    }
    card.hidden = false;

    const kind = marketKind76();
    if (badge) {
      badge.textContent = kind === 'real' ? '実オッズ確認済'
        : kind === 'predicted' ? '予想オッズ'
        : kind === 'unknown' ? '種別不明'
        : '市場待ち';
    }

    const rows = [...horses]
      .sort((a,b) => (b.win ?? -1) - (a.win ?? -1))
      .map(h => {
        const v = valueLabel76(h, kind);
        return `<article class="v76-market-row ${v.cls}">
          <div class="v76-market-head">
            <strong class="horse-number-badge">${esc76(h.no)}</strong>
            <span class="v76-mark">${esc76(h.mark || '')}</span>
            <strong>${esc76(h.name)}</strong>
          </div>
          <div class="v76-market-grid">
            <div><span>AI勝率</span><strong>${h.win == null ? '—' : h.win.toFixed(1)+'%'}</strong></div>
            <div><span>AIフェア</span><strong>${h.fair == null ? '—' : h.fair.toFixed(1)+'倍'}</strong></div>
            <div><span>実オッズ</span><strong>${kind === 'real' && h.odds ? h.odds.toFixed(1)+'倍' : '—'}</strong></div>
          </div>
          <div class="v76-value-line"><strong>${esc76(v.main)}</strong><span>${esc76(v.sub)}</span></div>
        </article>`;
      }).join('');

    if (list) list.innerHTML = rows;
    const pair = getSnapshotPair76();
    if (info) {
      const a = pair.first ? `初回市場 ${pair.first.checkedAt || pair.first.at}` : '初回市場 —';
      const b = pair.final ? `最終市場 ${pair.final.checkedAt || pair.final.at}` : '最終市場 —';
      info.textContent = `市場履歴｜${a} ｜ ${b}`;
    }
  }

  function attachTableLabels76(root=document) {
    root.querySelectorAll('table').forEach(table => {
      const heads = [...table.querySelectorAll('thead th')].map(x => x.textContent.trim());
      table.querySelectorAll('tbody tr').forEach(tr => {
        [...tr.children].forEach((td, i) => {
          if (heads[i]) td.setAttribute('data-label', heads[i]);
        });
      });
    });
  }

  function injectStyles76() {
    if ($v76('v76Styles')) return;
    const s = document.createElement('style');
    s.id = 'v76Styles';
    s.textContent = `
      .v76-market-note{padding:12px 14px;border:1px solid rgba(116,239,199,.22);border-radius:14px;margin-bottom:14px;line-height:1.55}
      .v76-market-list{display:grid;gap:12px}
      .v76-market-row{border:1px solid rgba(145,166,205,.24);border-radius:18px;padding:14px;background:rgba(255,255,255,.015)}
      .v76-market-row.v76-diamond,.v76-market-row.v76-diamond3{border-color:rgba(94,224,190,.6)}
      .v76-market-row.v76-warning{border-color:rgba(255,190,70,.55)}
      .v76-market-head{display:flex;align-items:center;gap:10px;margin-bottom:12px;font-size:1.05rem}
      .v76-mark{min-width:1.2em;text-align:center}
      .v76-market-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
      .v76-market-grid>div{border:1px solid rgba(145,166,205,.22);border-radius:13px;padding:9px;text-align:center}
      .v76-market-grid span{display:block;font-size:.72rem;opacity:.72;margin-bottom:3px}
      .v76-market-grid strong{font-size:1rem}
      .v76-value-line{margin-top:10px;display:grid;gap:3px}
      .v76-value-line span{font-size:.82rem;opacity:.78}
      .v76-snapshot-info{margin-top:12px;font-size:.82rem}
      @media(max-width:680px){
        .v76-market-grid{grid-template-columns:repeat(3,minmax(0,1fr))}
        #dashboardView .table-wrap{overflow:visible}
        #dashboardView table{display:block;width:100%;min-width:0}
        #dashboardView thead{display:none}
        #dashboardView tbody{display:grid;gap:10px}
        #dashboardView tr{display:grid;grid-template-columns:1fr 1fr;gap:7px 12px;border:1px solid rgba(145,166,205,.22);border-radius:16px;padding:12px}
        #dashboardView td{display:flex;justify-content:space-between;gap:8px;border:0!important;padding:5px 0!important;min-width:0}
        #dashboardView td::before{content:attr(data-label);opacity:.65;font-size:.78rem}
        #dashboardView td:first-child{grid-column:1/-1;font-weight:800;font-size:1.02rem}
        #dashboardView td:first-child::before{display:none}
      }
    `;
    document.head.appendChild(s);
  }

  function updateVersion76() {
    document.title = document.title.replace(/Ver\.\d+(?:\.\d+)?/g, `Ver.${VERSION}`);
    document.querySelectorAll('h1 span').forEach(x => {
      if (/Ver\./.test(x.textContent || '')) x.textContent = `Ver.${VERSION}`;
    });
  }

  // Attach market snapshots to the normal saved race object.
  try {
    const oldGetForm = getForm;
    getForm = function() {
      const d = oldGetForm();
      const pair = getSnapshotPair76();
      const list = loadSnaps76()[raceKey76()] || [];
      d.marketSnapshots = list.map(x => ({
        at:x.at, source:x.source, kind:x.kind, oddsType:x.oddsType,
        checkedAt:x.checkedAt, horses:x.horses
      }));
      d.marketFirst = pair.first || null;
      d.marketFinal = pair.final || null;
      return d;
    };
  } catch {}

  // Capture ordinary market input before/after ranking refresh.
  try {
    const oldRenderValueRanking = renderValueRanking;
    renderValueRanking = function(...args) {
      const out = oldRenderValueRanking.apply(this, args);
      captureSnapshot76('ui');
      renderMarketDiscipline76();
      return out;
    };
  } catch {}

  // Capture official NAR data. If checkedAt says "最終", preserve it as final market.
  try {
    const oldApplyOfficialOdds = applyOfficialOdds;
    applyOfficialOdds = function(data) {
      const n = oldApplyOfficialOdds(data);
      if (n) {
        captureSnapshot76(/最終/.test(String(data?.checkedAt || '')) ? 'official-final' : 'official');
        renderMarketDiscipline76();
      }
      return n;
    };
  } catch {}

  // Keep dashboard labels fresh after rerender.
  try {
    const oldRenderDashboard = renderDashboard;
    renderDashboard = function(...args) {
      const out = oldRenderDashboard.apply(this, args);
      setTimeout(() => attachTableLabels76($v76('dashboardView') || document), 0);
      return out;
    };
  } catch {}

  function boot76() {
    injectStyles76();
    updateVersion76();
    captureSnapshot76('boot');
    renderMarketDiscipline76();
    attachTableLabels76();
    document.addEventListener('input', (e) => {
      if (e.target?.matches?.('.odds,.pop,.win,.place,#oddsCheckedAt')) {
        setTimeout(() => {
          captureSnapshot76('input');
          renderMarketDiscipline76();
        }, 40);
      }
    });
    document.addEventListener('change', (e) => {
      if (e.target?.matches?.('.odds,.pop,.win,.place,#oddsCheckedAt,#oddsType')) {
        setTimeout(() => {
          captureSnapshot76('change');
          renderMarketDiscipline76();
        }, 40);
      }
    });

    const obs = new MutationObserver(() => {
      clearTimeout(window.__v76mut);
      window.__v76mut = setTimeout(() => {
        renderMarketDiscipline76();
        attachTableLabels76();
      }, 120);
    });
    obs.observe(document.body, {childList:true, subtree:true});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot76);
  else boot76();
})();
