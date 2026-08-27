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
  const map={'horse-no':'',mark:'','horse-name':'',win:'',place:'',ev:'',time:'',pop:'',odds:'','running-style':'先行',variance:'2.0','position-fail':'12','actual-time':'','data-confidence':'',reason:''};
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
function resultEntries(r){return [r.result1,r.result2,r.result3].map(x=>String(x||'').trim()).filter(Boolean);}
function isComplete(r){return resultEntries(r).length>0;}
function horsePosition(r,h){
  const results=resultEntries(r);
  const no=String(h['horse-no']||'').trim(), name=(h['horse-name']||'').trim();
  let i=no?results.indexOf(no):-1;
  if(i<0 && name)i=results.indexOf(name); // Ver.6.0以前の馬名保存データも互換
  return i>=0?i+1:null;
}

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
  el.innerHTML=`<div class="ai-score-head"><div><span>AI総合評価</span><strong>${b.overall.toFixed(0)}/100</strong></div><div><span>Sim勝率</span><strong>${win===null?'—':win.toFixed(1)+'%'}</strong></div><div><span>信頼度</span><strong>${derivedConfidence(h).toFixed(0)}%</strong></div></div><p class="ai-key"><strong>主なプラス:</strong> ${esc(strongest)}<br><strong>要確認:</strong> ${esc(weakest)}</p><details class="ai-score-details"><summary>分析スコア詳細（13項目）</summary><div class="ai-bars">${b.items.map(([label,val,note])=>`<div class="ai-bar-row" title="${esc(note)}"><div><span>${esc(label)}</span><em>${val.toFixed(0)}</em></div><div class="ai-bar-track"><i style="width:${clamp(val)}%"></i></div></div>`).join('')}</div><p class="hint">総合評価は入力要素の見える化スコアです。Sim勝率そのものは6,000回シミュレーション結果で、同じ意味ではありません。</p></details>`;
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
  const marketOverview=$('quickMarketStatus');
  try{
    const horseRows=[...document.querySelectorAll('.horse-row')];
    const hs=horseRows.map(horseFromRow).filter(h=>String(h['horse-name']||'').trim());
    if(!hs.length){
      if(marketOverview)marketOverview.textContent='市場データ：未取得';
      el.innerHTML='<p class="muted">馬データを入力すると一覧表示します。</p>';return;
    }
    const ability=[...hs].sort((a,b)=>(num(b.win)??-1)-(num(a.win)??-1));
    const rankMap=new Map(ability.map((h,i)=>[h,i+1]));
    const rows=hs.map((h,i)=>{
      let score=50; try{score=aiBreakdown(h,hs)?.overall ?? 50;}catch{}
      const conf=derivedConfidence(h);
      let v={ev:null,fair:fairOddsFromWin(num(h.win)),badge:'—',tone:''};
      try{v=valueAssessment(num(h.win),num(h.place),num(h.odds),num(h.pop),rankMap.get(h)||null,derivedConfidence(h))||v;}catch{}
      return {
        no:h['horse-no']||String(i+1), mark:h.mark||'', name:h['horse-name'],
        win:num(h.win), place:num(h.place), score:Number(score)||50, conf:Number(conf)||0, time:h.time||'',
        odds:num(h.odds), pop:num(h.pop), ...v
      };
    }).sort((a,b)=>(b.win??-1)-(a.win??-1));

    const oddsCount=rows.filter(x=>x.odds&&x.odds>0).length;
    const oddsType=$('oddsType')?.value||'';
    const checked=$('oddsCheckedAt')?.value||'';
    if(marketOverview){
      marketOverview.classList.toggle('has-market',oddsCount>0);
      marketOverview.textContent=oddsCount>0
        ? `市場データ：${oddsType&&oddsType!=='オッズなし'?oddsType:'取得済み'} ${oddsCount}/${rows.length}頭${checked?' ｜ '+checked:''}`
        : '市場データ：未取得 ｜ AIフェアオッズのみ表示';
    }

    el.innerHTML=`<div class="quick-mobile-list">${rows.map(x=>{
      const valueText=x.ev!==null?`期待 ${x.ev.toFixed(0)}%`:(x.fair?`AIフェア ${x.fair.toFixed(1)}倍`:'AIフェア —');
      const marketText=x.odds?`実 ${x.odds.toFixed(1)}倍${x.pop?' / '+x.pop+'人気':''}`:'';
      const badge=x.badge&&x.badge!=='—'?`<span class="quick-value-badge ${esc(x.tone||'')}">${esc(x.badge)}</span>`:'';
      return `<article class="quick-mobile-row">
        <div class="quick-mobile-head"><strong class="horse-number-badge">${esc(x.no)}</strong><span class="quick-mark">${esc(x.mark||'')}</span><strong class="quick-name">${esc(x.name)}</strong>${badge}</div>
        <div class="quick-mobile-stats"><div><span>勝</span><strong>${x.win===null?'—':x.win.toFixed(1)+'%'}</strong></div><div><span>複</span><strong>${x.place===null?'—':x.place.toFixed(1)+'%'}</strong></div><div><span>TIME</span><strong>${esc(x.time||'—')}</strong></div></div>
        <div class="quick-judgement-row">${marketText?`<span>${marketText}</span>`:'<span>実オッズ —</span>'}<span class="${x.ev!==null&&x.ev>=100?'positive':''}">${valueText}</span></div>
      </article>`;
    }).join('')}</div>`;
  }catch(err){
    console.error('quick compare render failed',err);
    const fallback=[...document.querySelectorAll('.horse-row')].map(horseFromRow).filter(h=>h['horse-name']);
    if(marketOverview)marketOverview.textContent='市場データ：確認中';
    if(fallback.length){el.innerHTML=`<div class="quick-mobile-list">${fallback.map((h,i)=>`<article class="quick-mobile-row"><div class="quick-mobile-head"><strong class="horse-number-badge">${esc(h['horse-no']||i+1)}</strong><span class="quick-mark">${esc(h.mark||'')}</span><strong class="quick-name">${esc(h['horse-name'])}</strong></div><div class="quick-mobile-stats"><div><span>勝</span><strong>${num(h.win)===null?'—':num(h.win).toFixed(1)+'%'}</strong></div><div><span>複</span><strong>${num(h.place)===null?'—':num(h.place).toFixed(1)+'%'}</strong></div><div><span>TIME</span><strong>${esc(h.time||'—')}</strong></div></div></article>`).join('')}</div>`;}
  }
}

function renderAllAiBreakdowns(){
  const rows=[...document.querySelectorAll('.horse-row')], hs=rows.map(horseFromRow);
  rows.forEach(r=>{consolidateHorseDetails(r);renderAiBreakdown(r,hs);refreshCompactSummary(r,hs);});
  renderQuickCompare();
}
function normalRand(){let u=0,v=0;while(!u)u=Math.random();while(!v)v=Math.random();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);}
function logicAvgHorse(h){const vals=Object.values(h.logic||{}).map(num).filter(v=>v!==null);return vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:5;}
function scenarioAdjustment(style,sc){const m={normal:{逃げ:0,先行:0,差し:0,追込:0},high:{逃げ:.7,先行:.25,差し:-.25,追込:-.15},slow:{逃げ:-.4,先行:-.2,差し:.3,追込:.55}};return m[sc]?.[style]??0;}
function fairOddsFromWin(win){const w=num(win);return w&&w>0?100/w:null;}
function derivePopularityFromOdds(){
  const rows=[...document.querySelectorAll('.horse-row')];
  const priced=rows.map(r=>({r,o:num(r.querySelector('.odds')?.value)})).filter(x=>x.o&&x.o>0).sort((a,b)=>a.o-b.o);
  priced.forEach((x,i)=>{const p=x.r.querySelector('.pop');if(p&&!num(p.value))p.value=String(i+1);});
}
function autoAssignMarks(){
  const rows=[...document.querySelectorAll('.horse-row')].filter(r=>r.querySelector('.horse-name')?.value.trim());
  rows.forEach(r=>{const m=r.querySelector('.mark');if(m)m.value='';});
  const ability=rows.map(r=>{const h=horseFromRow(r);return {r,h,w:num(h.win)||-1,conf:derivedConfidence(h),pop:num(h.pop),odds:num(h.odds)};}).sort((a,b)=>b.w-a.w);
  let used=0;
  for(const x of ability){
    // 低信頼馬は市場の裏付けが無い限り主要印を自動付与しない。
    // ただし実オッズで3人気以内なら「未知の人気馬」として印対象に戻す。
    const marketBacked=x.odds&&x.pop&&x.pop<=3;
    if(x.conf<55&&!marketBacked)continue;
    const marks=['◎','○','▲']; if(used>=marks.length)break;
    x.r.querySelector('.mark').value=marks[used++];
  }
}
function simBadge(ev,pop,place){if(ev>=135&&pop>=10&&place>=18)return '💎💎💎';if(ev>=115&&pop>=4&&place>=20)return '💎';if(ev<75&&pop>0&&pop<=3)return '⚠️';return '—';}
function confidenceRaceFactor(h){
  // Ver.6.6: 低信頼=弱い、とは置かない。
  // 園田1Rの初出走馬勝利を踏まえ、信頼度は能力ペナルティではなく不確実性に反映する。
  return 1;
}
function effectiveVariance(h){
  const base=Math.max(.20,num(h.variance)||2), c=derivedConfidence(h);
  // 低信頼ほど分布を広げる。能力平均そのものは下げない。
  return base*(1+Math.max(0,60-c)/100*1.35);
}
function marketBlendProbabilities(valid, raw){
  const priced=valid.map((x,i)=>({x,i,o:num(x.h.odds),conf:derivedConfidence(x.h)})).filter(z=>z.o&&z.o>0);
  if(priced.length<Math.max(3,Math.ceil(valid.length*.60)))return raw;
  const inv=priced.reduce((a,z)=>a+1/z.o,0); if(!inv)return raw;
  const market=new Map(priced.map(z=>[z.i,(1/z.o)/inv*100]));
  let wins=raw.map((r,i)=>{
    if(!market.has(i))return r.wp;
    const c=priced.find(z=>z.i===i)?.conf??60;
    // 高信頼モデルはAI寄り、低信頼モデルは市場寄り。最低でもAI25%は残す。
    const modelW=Math.max(.25,Math.min(.85,.25+(c/100)*.67));
    return r.wp*modelW+market.get(i)*(1-modelW);
  });
  const sw=wins.reduce((a,b)=>a+b,0)||100; wins=wins.map(v=>v/sw*100);
  let places=raw.map((r,i)=>{
    const ratio=r.wp>0?wins[i]/r.wp:1;
    return Math.max(0,Math.min(100,r.pp*Math.sqrt(Math.max(.25,ratio))));
  });
  const sp=places.reduce((a,b)=>a+b,0)||300; const target=Math.min(300,100*valid.length);
  places=places.map(v=>Math.min(100,v/sp*target));
  return raw.map((r,i)=>({...r,wp:wins[i],pp:places[i],marketBlended:market.has(i)}));
}
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
    const scores=valid.map(x=>{const fail=Math.random()<((num(x.h['position-fail'])||0)/100); const vr=Math.max(.002,effectiveVariance(x.h)/100); const base=x.base; const confFactor=confidenceRaceFactor(x.h); const logicAdj=(5-x.logic)*0.12; const scen=scenarioAdjustment(x.h['running-style'],sc); const noise=normalRand()*base*vr; const failPenalty=fail?base*.012:0; const t=base*confFactor+logicAdj+scen+noise+failPenalty; x.totalTime+=t;x.countTime++;return {x,t};}).sort((a,b)=>a.t-b.t);
    scores[0].x.wins++; scores.slice(0,Math.min(3,scores.length)).forEach(y=>y.x.places++);
  }
  let totalWin=0,totalPlace=0;
  const raw=valid.map(x=>({wp:x.wins/N*100,pp:x.places/N*100,avg:x.totalTime/x.countTime}));
  derivePopularityFromOdds();
  const calibrated=marketBlendProbabilities(valid,raw);
  valid.forEach((x,i)=>{const {wp,pp,avg,marketBlended}=calibrated[i]; totalWin+=wp;totalPlace+=pp; x.r.querySelector('.win').value=wp.toFixed(1); x.r.querySelector('.place').value=pp.toFixed(1); const tag=marketBlended?'市場融合AI':'純Sim'; x.r.querySelector('.sim-result').innerHTML=`<strong>${tag}勝率 ${wp.toFixed(1)}% / 複勝率 ${pp.toFixed(1)}%</strong><span>平均 ${formatRaceTime(avg)} / AIフェア ${fairOddsFromWin(wp).toFixed(1)}倍</span>`;}); renderValueRanking(); autoAssignMarks(); renderValueRanking(); renderAllAiBreakdowns();
  const now=new Date().toISOString(); const el=$('simulationSummary');
  el.textContent=`6,000回実行済み・市場データ取得時は信頼度連動で融合｜勝率合計 ${totalWin.toFixed(1)}%・複勝率合計 ${totalPlace.toFixed(1)}%｜標準 ${(probs[0]/sum*100).toFixed(0)}%・ハイ ${(probs[1]/sum*100).toFixed(0)}%・スロー ${(probs[2]/sum*100).toFixed(0)}%`;
  Object.assign(el.dataset,{runs:'6000',executedAt:now,normal:String(probs[0]/sum*100),high:String(probs[1]/sum*100),slow:String(probs[2]/sum*100)});
  return true;
}
function formatRaceTime(s){if(!Number.isFinite(s))return '—';const m=Math.floor(s/60),sec=s-m*60;return m?`${m}:${sec.toFixed(1).padStart(4,'0')}`:`${sec.toFixed(1)}秒`;}


function impliedProbability(odds){
  const o=num(odds); return o&&o>0?100/o:null;
}
function valueAssessment(win,place,odds,pop,aiRank=null,confidence=null){
  const o=num(odds), p=num(pop), w=num(win), pl=num(place), conf=num(confidence);
  const implied=o&&o>0?100/o:null;
  const fair=fairOddsFromWin(w);
  const ev=(o&&w!==null)?w*o:null;
  const gap=(implied!==null&&w!==null)?w-implied:null;
  const rankGap=(p!==null&&aiRank!==null)?p-aiRank:null;
  let badge='—', tone='neutral', reason=fair?`AIフェアオッズ ${fair.toFixed(1)}倍 / 市場オッズ待ち`:'勝率未計算';
  if(o&&w!==null){
    badge='適正圏'; reason=`期待回収率 ${ev.toFixed(1)}% / AIフェア ${fair.toFixed(1)}倍`;
    if(p!==null && p>=8 && pl!==null && pl>=18 && ev>=125){badge='💎💎💎 大穴';tone='diamond3';reason=`${p}人気・複勝率${pl.toFixed(1)}%・期待${ev.toFixed(1)}%・市場${o.toFixed(1)}倍`;}
    else if(p!==null && ((p>=4&&pl!==null&&pl>=25&&ev>=110)||(p>=5&&pl!==null&&pl>=18&&(ev>=108||(gap!==null&&gap>=2.5))))){badge='💎 穴馬';tone='diamond';reason=`${p}人気・複勝率${pl.toFixed(1)}%・期待${ev.toFixed(1)}%・市場差${gap>=0?'+':''}${gap.toFixed(1)}pt`;}
    else if(p!==null && p>=6 && aiRank!==null && rankGap>=2 && pl!==null && pl>=20 && ev>=95){badge='💎 穴候補';tone='diamond';reason=`能力${aiRank}位に対し市場${p}人気・複勝率${pl.toFixed(1)}%・期待${ev.toFixed(1)}%`;}
    else if(conf!==null && conf<45 && p!==null && p<=2){badge='🧩 未知の人気馬';tone='candidate';reason=`データ信頼${conf.toFixed(0)}%だが市場${p}人気。能力断定せず市場情報を強めに融合`;}
    if(p!==null && p<=3 && ((gap!==null&&gap<=-5)||ev<82)){
      let n=1; if((gap!==null&&gap<=-12)||ev<62)n=3; else if((gap!==null&&gap<=-8)||ev<72)n=2;
      badge='⚠️'.repeat(n)+' 人気馬注意'; tone='warning'; reason=`市場勝率${implied.toFixed(1)}%に対しAI${w.toFixed(1)}% / 期待${ev.toFixed(1)}%`;
    }
  } else if(p!==null && aiRank!==null && p>=6 && rankGap>=2 && pl!==null && pl>=22){
    badge='◇ 能力穴候補'; tone='candidate'; reason=`能力${aiRank}位に対し${p}人気想定・複勝率${pl.toFixed(1)}%（実オッズ未確認）`;
  }
  return {ev,implied,fair,gap,rankGap,badge,tone,reason};
}
function renderValueRanking(){
  derivePopularityFromOdds();
  const base=[...document.querySelectorAll('.horse-row')].map(r=>{
    const name=r.querySelector('.horse-name').value.trim(); if(!name)return null;
    const h=horseFromRow(r); return {r,no:r.querySelector('.horse-no')?.value||'',name,win:num(r.querySelector('.win').value),place:num(r.querySelector('.place').value),odds:num(r.querySelector('.odds').value),pop:num(r.querySelector('.pop').value),conf:derivedConfidence(h)};
  }).filter(Boolean);
  const sortedAbility=[...base].filter(x=>x.win!==null).sort((a,b)=>b.win-a.win); const rankMap=new Map(sortedAbility.map((x,i)=>[x.r,i+1]));
  const rows=base.map(x=>{
    const v=valueAssessment(x.win,x.place,x.odds,x.pop,rankMap.get(x.r)||null,x.conf);
    const vr=x.r.querySelector('.value-result');
    if(vr){vr.className='value-result '+v.tone; vr.innerHTML=`<strong>${v.badge}</strong><span>${esc(v.reason)}${v.gap!==null?` / 市場差 ${v.gap>=0?'+':''}${v.gap.toFixed(1)}pt`:''}</span>`;}
    const evEl=x.r.querySelector('.ev'); if(evEl){evEl.value=v.ev!==null?v.ev.toFixed(1):'';evEl.placeholder=v.fair?`市場待ち / AIフェア${v.fair.toFixed(1)}倍`:'自動算出';}
    return {...x,aiRank:rankMap.get(x.r)||null,...v};
  });
  const ability=[...rows].filter(x=>x.win!==null).sort((a,b)=>b.win-a.win).slice(0,5);
  const value=[...rows].filter(x=>x.ev!==null).sort((a,b)=>b.ev-a.ev).slice(0,5);
  const diamonds=rows.filter(x=>x.tone==='diamond'||x.tone==='diamond3'||x.tone==='candidate').sort((a,b)=>(b.ev??0)-(a.ev??0)||(b.rankGap??0)-(a.rankGap??0));
  const warnings=rows.filter(x=>x.tone==='warning').sort((a,b)=>(a.ev??999)-(b.ev??999));
  const oddsCount=rows.filter(x=>x.odds).length;
  const marketCard=$('marketCard'); if(marketCard) marketCard.hidden=!(oddsCount||diamonds.length);
  const status=$('marketStatus'); if(status){status.textContent=oddsCount?`${$('oddsType')?.value||'種別不明'} ${oddsCount}頭 / 人気自動算出`:'市場データ未取得';}
  const rank=(arr,formatter)=>arr.length?arr.map((x,i)=>`<div class="rank-row"><span>${i+1}</span><strong>${x.no?esc(x.no)+'番 ':''}${esc(x.name)}</strong><em>${formatter(x)}</em></div>`).join(''):'<p class="muted">対象なし</p>';
  const el=$('valueRanking'); if(!el)return;
  el.innerHTML=`<div class="rank-grid"><div><h3>🏆 能力順位</h3>${rank(ability,x=>`勝率 ${x.win.toFixed(1)}% / フェア${x.fair?.toFixed(1)||'—'}倍`)}</div><div><h3>💰 期待値順位</h3>${value.length?rank(value,x=>`期待 ${x.ev.toFixed(1)}%`):'<p class="muted">実オッズ取得後に自動算出</p>'}</div></div><div class="rank-grid value-flags"><div><h3>💎 穴馬候補</h3>${diamonds.length?diamonds.map(x=>`<div class="flag-row"><strong>${x.badge} ${x.no?esc(x.no)+'番 ':''}${esc(x.name)}</strong><span>${esc(x.reason)}</span></div>`).join(''):'<p class="muted">市場との乖離が確認できる候補なし</p>'}</div><div><h3>⚠️ 人気馬リスク</h3>${warnings.length?warnings.map(x=>`<div class="flag-row"><strong>${x.badge} ${x.no?esc(x.no)+'番 ':''}${esc(x.name)}</strong><span>${esc(x.reason)}</span></div>`).join(''):'<p class="muted">条件該当なし</p>'}</div></div>`;
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
horseList.addEventListener('input',e=>{if(e.target.matches('.odds,.pop,.win,.place')){ if(e.target.matches('.odds')){const any=[...document.querySelectorAll('.odds')].some(x=>num(x.value)!==null); if(any && (!$('oddsType').value || $('oddsType').value==='オッズなし'))setAutoOddsMeta('種別不明',$('oddsCheckedAt')?.value||''); if(!any)setAutoOddsMeta('オッズなし','');derivePopularityFromOdds();} renderValueRanking();autoAssignMarks();renderAllAiBreakdowns();}});

$('raceDate').valueAsDate=new Date(); setAutoOddsMeta('オッズなし',''); for(let i=0;i<5;i++) addHorse(); renderArchive(); renderDashboard(); renderValueRanking(); renderAllAiBreakdowns();

// Ver.5: bulk import + assisted scoring
const V5_ALIASES={
  horseNo:['horseNo','horseNumber','馬番','馬番号'], horseName:['horseName','horse','name','馬名'], mark:['mark','印','評価'], predictedTime:['predictedTime','time','予想走破タイム','予想タイム'],
  popularity:['popularity','pop','人気','想定人気','rank','人気順','単勝人気'], odds:['odds','オッズ','winOdds','tanOdds','単勝','単勝オッズ','realOdds','currentOdds','finalOdds','predictedOdds','forecastOdds','expectedOdds','予想オッズ','実オッズ'], runningStyle:['runningStyle','style','脚質'], variance:['variance','ブレ幅'], positionFail:['positionFail','position-fail','位置取り失敗率'],
  timeIndex:['timeIndex','タイム指数'], distanceIndex:['distanceIndex','距離指数'], courseIndex:['courseIndex','コース指数'], recentIndex:['recentIndex','近走指数'],
  runTheory:['runTheory','走破理論'], paceFit:['paceFit','展開適性'], trackFit:['trackFit','馬場適性'], distanceFit:['distanceFit','距離適性'], courseFit:['courseFit','コース適性'],
  bounce:['bounce','叩き効果'], lastRaceMemory:['lastRaceMemory','前走記憶'], loadLap:['loadLap','5・7・9H負荷','579H負荷'], training:['training','調教'], draw:['draw','枠'], weight:['weight','斤量'], jockey:['jockey','騎手'],
  oddsType:['oddsType','oddsKind','odds_type','オッズ種別'], oddsCheckedAt:['oddsCheckedAt','oddsTime','oddsTimestamp','オッズ確認時刻','確認時刻'], oddsSource:['oddsSource','source','dataSource','取得元','情報源'], dataConfidence:['dataConfidence','confidence','data-confidence','データ信頼度'], reason:['reason','根拠','コメント'], category:['category','競馬区分'], raceDate:['raceDate','date','日付'], track:['track','競馬場'], raceNo:['raceNo','race','レース'], distance:['distance','距離'], chaos:['chaos','波乱度'], bias:['bias','馬場傾向'], pace:['pace','展開予測']
};
function marketScalar(v,key='odds'){
  if(v===undefined||v===null)return '';
  if(typeof v==='object'){
    const candidates=key==='popularity'
      ? ['popularity','pop','rank','人気','人気順','単勝人気']
      : ['odds','winOdds','tanOdds','win','value','単勝','単勝オッズ','実オッズ','予想オッズ'];
    for(const k of candidates){if(v[k]!==undefined&&v[k]!==null)return marketScalar(v[k],key);}
    return '';
  }
  const s=String(v).trim();
  if(!s)return '';
  if(key==='popularity'){
    const m=s.replace(/,/g,'').match(/(?:^|[^0-9])([0-9]{1,2})(?:番人気|人気)?/); return m?m[1]:s;
  }
  const m=s.replace(/,/g,'').match(/([0-9]+(?:\.[0-9]+)?)/); return m?m[1]:s;
}
function pickAlias(obj,key){
  if(!obj||typeof obj!=='object')return '';
  for(const k of V5_ALIASES[key]||[key]){
    if(obj[k]!==undefined&&obj[k]!==null&&String(obj[k]).trim()!=='')return (key==='odds'||key==='popularity')?marketScalar(obj[k],key):obj[k];
  }
  const nested=['market','marketData','oddsData','price','prices','betting','winMarket'];
  for(const nk of nested){const n=obj[nk];if(n&&typeof n==='object'){for(const k of V5_ALIASES[key]||[key]){if(n[k]!==undefined&&n[k]!==null)return (key==='odds'||key==='popularity')?marketScalar(n[k],key):n[k];}}}
  return '';
}
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
  return {'horse-no':String(pickAlias(raw,'horseNo')||'').trim(),mark:pickAlias(raw,'mark')||'','horse-name':String(pickAlias(raw,'horseName')||'').trim(),win:'',place:'',ev:'',time:String(pickAlias(raw,'predictedTime')||'').trim(),pop:String(pickAlias(raw,'popularity')||''),odds:String(pickAlias(raw,'odds')||''),'running-style':pickAlias(raw,'runningStyle')||'先行',variance:String(pickAlias(raw,'variance')||'2.0'),'position-fail':String(pickAlias(raw,'positionFail')||'12'),'actual-time':'','data-confidence':String(pickAlias(raw,'dataConfidence')||''),reason:String(pickAlias(raw,'reason')||''),logic:direct};
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
  if(ok&&autoSave){saveCurrentSilent(); $('importStatus').textContent += ' 6,000回シミュレーション実行・保存まで完了しました。';} renderAllAiBreakdowns(); setTimeout(renderQuickCompare,60);
  return ok;
}
function importRaceRows(rows,meta={}){
  if(!rows.length)throw new Error('出走馬データがありません'); const ctx=buildContext(rows); const hs=rows.map(r=>normalizeImportedHorse(r,ctx)).filter(h=>h['horse-name']); if(hs.length<2)throw new Error('馬名を2頭以上確認できませんでした');
  applyRaceMeta(Object.assign({},rows[0]||{},meta));
  const autoOddsType=detectOddsType(rows,meta), autoOddsTime=detectOddsCheckedAt(rows,meta); setAutoOddsMeta(autoOddsType,autoOddsTime);
  horseList.innerHTML=''; hs.forEach(addHorse); const marketN=hs.filter(h=>num(h.odds)!==null).length; $('importStatus').textContent=`${hs.length}頭読込 / オッズ${marketN?marketN+'頭取得':'未確認'} / 自動採点・6,000回Simへ`;
  renderAllAiBreakdowns(); setTimeout(renderQuickCompare,0); if($('autoRunAfterImport').checked){setTimeout(()=>{runFullPipeline(true);setTimeout(renderQuickCompare,80);},0);} return hs.length;
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
function mergeMarketIntoRows(rows,root={}){
  const out=rows.map(r=>Object.assign({},r));
  const byNo=new Map(), byName=new Map();
  out.forEach((r,i)=>{const no=String(pickAlias(r,'horseNo')||i+1);byNo.set(no,r);const nm=String(pickAlias(r,'horseName')||'').trim();if(nm)byName.set(nm,r);});
  const apply=(entry,keyHint='')=>{
    if(entry===undefined||entry===null)return;
    if(typeof entry==='number'||typeof entry==='string'){
      const r=byNo.get(String(keyHint)); if(r&&!pickAlias(r,'odds'))r.odds=marketScalar(entry,'odds'); return;
    }
    if(Array.isArray(entry)){entry.forEach((x,i)=>apply(x,String(i+1)));return;}
    if(typeof entry==='object'){
      const no=String(pickAlias(entry,'horseNo')||entry.number||entry.no||keyHint||'');
      const nm=String(pickAlias(entry,'horseName')||entry.name||'').trim();
      const r=byNo.get(no)||byName.get(nm);
      if(r){
        const o=pickAlias(entry,'odds'); if(o!==''&&!pickAlias(r,'odds'))r.odds=marketScalar(o,'odds');
        const p=pickAlias(entry,'popularity'); if(p!==''&&!pickAlias(r,'popularity'))r.popularity=marketScalar(p,'popularity');
        if(entry.oddsType&&!r.oddsType)r.oddsType=entry.oddsType;
        if(entry.oddsCheckedAt&&!r.oddsCheckedAt)r.oddsCheckedAt=entry.oddsCheckedAt;
        return;
      }
      Object.entries(entry).forEach(([k,v])=>{if(/^\d+$/.test(k))apply(v,k);});
    }
  };
  [root.odds,root.marketOdds,root.winOdds,root.oddsData,root.market,root.markets,root.race?.odds,root.race?.market].forEach(x=>apply(x));
  return out;
}
function parseRaceJson(text){
  const t=cleanJsonText(text); let d;
  try{d=JSON.parse(t);}catch(e){const hint=jsonStructureHint(t);throw new Error(hint||`JSON構文エラー：${e.message}`);}
  if(Array.isArray(d)){if(d[0]?.horses)throw new Error('これは保存バックアップJSONです。レース一括取込ではなく下部の「JSONを読み込み」を使用してください。');return {rows:d,meta:{}};}
  if(d&&Array.isArray(d.horses))return {rows:mergeMarketIntoRows(d.horses,d),meta:Object.assign({},d.meta||{},d.race||{})};
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


// Ver.6.8: race-result auto persistence + instant validation.
let resultSaveTimer=null;
function raceKey(d){return `${d.raceDate||''}|${d.track||''}|${String(d.raceNo||'')}`;}
function autoPersistResult(){
  clearTimeout(resultSaveTimer);
  resultSaveTimer=setTimeout(()=>{
    const d=getForm(), entries=resultEntries(d), status=$('resultSaveStatus');
    if(!entries.length){if(status)status.textContent='結果待ち'; refreshResultAutoReview(); return;}
    if(!d.raceDate||!d.track||!d.raceNo){if(status)status.textContent='レース情報不足'; return;}
    const all=loadAll(), idx=all.findIndex(x=>raceKey(x)===raceKey(d));
    if(idx>=0){
      // Preserve the original pre-race prediction; update only post-race fields and actual times.
      const old=all[idx]; old.result1=d.result1; old.result2=d.result2; old.result3=d.result3; old.review=d.review; old.resultUpdatedAt=new Date().toISOString();
      const byNo=new Map((d.horses||[]).map(h=>[String(h['horse-no']||''),h]));
      (old.horses||[]).forEach(h=>{const cur=byNo.get(String(h['horse-no']||'')); if(cur&&cur['actual-time'])h['actual-time']=cur['actual-time'];});
      saveAll(all); renderArchive(); renderDashboard(); if(status)status.textContent='自動保存済';
    }else{
      d.resultUpdatedAt=new Date().toISOString(); all.unshift(d); saveAll(all); renderArchive(); renderDashboard(); if(status)status.textContent='新規保存済';
    }
    refreshResultAutoReview();
  },350);
}
function refreshResultAutoReview(){
  const el=$('resultAutoReview'); if(!el)return; const d=getForm(), rs=resultEntries(d); if(!rs.length){el.textContent='結果を入力すると自動検証します。';return;}
  const hs=d.horses||[], top=[...hs].filter(h=>num(h.win)!==null).sort((a,b)=>num(b.win)-num(a.win))[0];
  const winner=hs.find(h=>String(h['horse-no'])===String(rs[0]));
  const timeErrs=hs.map(h=>{const p=parseTime(h.time),a=parseTime(h['actual-time']);return p!==null&&a!==null?Math.abs(p-a):null}).filter(x=>x!==null);
  const mae=timeErrs.length?timeErrs.reduce((a,b)=>a+b,0)/timeErrs.length:null;
  const bits=[`1着：${winner?winner['horse-name']+'（'+winner['horse-no']+'番）':rs[0]+'番'}`];
  if(top)bits.push(`AI勝率1位 ${top['horse-no']}番→${horsePosition(d,top)??'圏外'}`);
  if(mae!==null)bits.push(`TIME平均誤差 ${mae.toFixed(2)}秒`);
  el.textContent='自動検証｜'+bits.join(' ｜ ');
}
['result1','result2','result3','review'].forEach(id=>{const e=$(id);if(e){e.addEventListener('input',autoPersistResult);e.addEventListener('change',autoPersistResult);}});
document.addEventListener('input',e=>{if(e.target?.classList?.contains('actual-time'))autoPersistResult();});

// === Ver.7.0: split NAR API worker + static frontend ===

const NAR_API_STORAGE_KEY='chass_nar_api_base_v1';
function normalizedApiBase(v){return String(v||'').trim().replace(/\/+$/,'');}
function getNarApiBase(){return normalizedApiBase(localStorage.getItem(NAR_API_STORAGE_KEY)||'');}
function saveNarApiBase(v){const x=normalizedApiBase(v); if(x)localStorage.setItem(NAR_API_STORAGE_KEY,x); else localStorage.removeItem(NAR_API_STORAGE_KEY); return x;}
function narApiUrl(path){const base=getNarApiBase(); return base ? base+path : path;}
const NAR_TRACK_CODES = {'門別':'36','船橋':'19','笠松':'22','園田':'27','姫路':'28'};
function narTrackCode(){
  const track=String($('track')?.value||'').trim();
  const savedCode=String(window.__narCode||'').trim();
  return savedCode || NAR_TRACK_CODES[track] || '';
}
function setOfficialStatus(text,kind=''){
  const el=$('officialResultStatus'); if(!el)return;
  el.textContent=text; el.classList.remove('official-sync-ok','official-sync-warn');
  if(kind==='ok')el.classList.add('official-sync-ok');
  if(kind==='warn')el.classList.add('official-sync-warn');
}
function currentRaceApiParams(){
  return new URLSearchParams({code:narTrackCode(),date:String($('raceDate')?.value||''),race:String($('raceNo')?.value||'')});
}
function applyOfficialOdds(data){
  if(!data?.odds?.length)return 0;
  const byNo=new Map(data.odds.map(x=>[String(x.horseNo),x])); let n=0;
  [...document.querySelectorAll('.horse-row')].forEach(r=>{
    const no=String(r.querySelector('.horse-no')?.value||'').trim(), x=byNo.get(no); if(!x)return;
    const odds=r.querySelector('.odds'), pop=r.querySelector('.pop');
    if(x.winOdds!=null && odds){odds.value=x.winOdds;n++;}
    if(x.popularity!=null && pop)pop.value=x.popularity;
  });
  if(n){setAutoOddsMeta('実オッズ',data.checkedAt||'最終');derivePopularityFromOdds();renderValueRanking();autoAssignMarks();renderAllAiBreakdowns();}
  return n;
}
function applyOfficialResult(data){
  const order=data?.finishOrder||[]; if(order.length>=3){
    $('result1').value=order[0]; $('result2').value=order[1]; $('result3').value=order[2];
  }
  const times=data?.actualTimes||{};
  [...document.querySelectorAll('.horse-row')].forEach(r=>{
    const no=String(r.querySelector('.horse-no')?.value||'').trim(), t=times[no];
    if(t && r.querySelector('.actual-time'))r.querySelector('.actual-time').value=t;
  });
  if(order.length)autoPersistOutcome();
  return order.length;
}
async function fetchOfficialNar({silent=false}={}){
  const code=narTrackCode(), date=String($('raceDate')?.value||''), race=String($('raceNo')?.value||'');
  if(!code||!date||!race){if(!silent)setOfficialStatus('NAR競馬場コード・日付・Rが不足しています。','warn');return false;}
  try{
    setOfficialStatus('NAR公式を確認中…');
    const res=await fetch(narApiUrl('/api/nar/sync?'+currentRaceApiParams().toString()),{headers:{'accept':'application/json'}});
    if(!res.ok)throw new Error(res.status===404?'公式取得APIが未導入です':'HTTP '+res.status);
    const data=await res.json();
    const on=applyOfficialOdds(data), rn=applyOfficialResult(data);
    if(!on&&!rn){setOfficialStatus(data.pending?'結果待ち：NAR公式ではまだ確定していません。':'公式ページは取得できましたが解析対象データを確認できません。','warn');return false;}
    saveCurrentSilent(); renderArchive(); renderDashboard();
    setOfficialStatus(`NAR公式反映：${on?`最終オッズ ${on}頭`:''}${on&&rn?' / ':''}${rn?`着順 ${data.finishOrder.slice(0,3).join('-')}`:''}`,'ok');
    return true;
  }catch(e){
    const msg=String(e?.message||e);
    setOfficialStatus(`公式取得失敗：${msg}`,'warn');
    return false;
  }
}
$('fetchOfficialResult')?.addEventListener('click',()=>fetchOfficialNar({silent:false}));
// 保存済み/読み込み済みレースは、画面が落ち着いてから一度だけ自動照合。
setTimeout(()=>{if($('track')?.value&&$('raceNo')?.value)fetchOfficialNar({silent:true});},1200);

// Ver.7.0 one-time NAR API connection settings
(function(){
  const input=$('narApiBase'), saveBtn=$('saveNarApiBase'), testBtn=$('testNarApiBase');
  if(input)input.value=getNarApiBase();
  if(getNarApiBase())setOfficialStatus('NAR自動連携：設定済み');
  saveBtn?.addEventListener('click',()=>{
    const v=saveNarApiBase(input?.value||'');
    setOfficialStatus(v?'NAR自動連携：保存しました。':'NAR自動連携：未設定','ok');
  });
  testBtn?.addEventListener('click',async()=>{
    const v=saveNarApiBase(input?.value||''); if(!v){setOfficialStatus('Worker URLを入力してください。','warn');return;}
    try{const r=await fetch(narApiUrl('/api/health'),{headers:{accept:'application/json'}}); if(!r.ok)throw new Error('HTTP '+r.status); const d=await r.json(); setOfficialStatus(`NAR自動連携：接続OK（API ${d.version||''}）`,'ok');}
    catch(e){setOfficialStatus('NAR自動連携：接続失敗 '+String(e?.message||e),'warn');}
  });
})();
