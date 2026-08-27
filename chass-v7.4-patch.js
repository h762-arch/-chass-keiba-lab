// Chass Keiba Lab Ver.7.4 patch
// 1) Expand NAR track codes
// 2) Use same-origin /api by default (manual Worker URL no longer required)
// 3) Update visible version label to Ver.7.4
// 4) Hide legacy NAR API URL setup UI when same-origin API is available

try {
  if (typeof NAR_TRACK_CODES === 'object' && NAR_TRACK_CODES) {
    Object.assign(NAR_TRACK_CODES, {
      '船橋':'19',
      '笠松':'22',
      '園田':'27',
      '姫路':'28',
      '門別':'36'
    });
  }
} catch (e) {
  console.warn('NAR_TRACK_CODES patch skipped', e);
}

// Always allow same-origin API when manual base URL is not set.
try {
  narApiUrl = function(path){
    const base = (typeof getNarApiBase === 'function' ? getNarApiBase() : '');
    return base ? base + path : path;
  };
} catch (e) {
  console.warn('narApiUrl patch skipped', e);
}

// Replace fetchOfficialNar so manual Worker URL is not mandatory.
try {
  fetchOfficialNar = async function({silent=false}={}){
    const code=narTrackCode(),
          date=String($('raceDate')?.value||''),
          race=String($('raceNo')?.value||'');

    if(!code||!date||!race){
      if(!silent) setOfficialStatus('NAR競馬場コード・日付・Rが不足しています。','warn');
      return false;
    }

    try{
      setOfficialStatus('NAR公式を確認中…');

      const res=await fetch(
        narApiUrl('/api/nar/sync?'+currentRaceApiParams().toString()),
        {headers:{'accept':'application/json'}}
      );

      if(!res.ok){
        throw new Error(res.status===404 ? '公式取得APIが未導入です' : 'HTTP '+res.status);
      }

      const data=await res.json();
      const on=applyOfficialOdds(data),
            rn=applyOfficialResult(data);

      if(!on&&!rn){
        setOfficialStatus(
          data.pending
            ? '結果待ち：NAR公式ではまだ確定していません。'
            : '公式ページは取得できましたが解析対象データを確認できません。',
          'warn'
        );
        return false;
      }

      saveCurrentSilent();
      renderArchive();
      renderDashboard();

      setOfficialStatus(
        `NAR公式反映：${on?`最終オッズ ${on}頭`:''}${on&&rn?' / ':''}${rn?`着順 ${data.finishOrder.slice(0,3).join('-')}`:''}`,
        'ok'
      );
      return true;
    }catch(e){
      const msg=String(e?.message||e);
      setOfficialStatus(`公式取得失敗：${msg}`,'warn');
      return false;
    }
  };
} catch (e) {
  console.warn('fetchOfficialNar patch skipped', e);
}

function chassSetVersionLabel(version='7.4'){
  try{
    const walker=document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while((n=walker.nextNode())){
      if(/Ver\.7\.1|Ver\.7\.2|Ver\.7\.3/.test(n.nodeValue||'')){
        n.nodeValue=(n.nodeValue||'').replace(/Ver\.7\.[123]/g,`Ver.${version}`);
      }
    }
    document.title=document.title.replace(/Ver\.7\.[123]/g,`Ver.${version}`);
  }catch(e){
    console.warn('version label patch skipped', e);
  }
}

async function chassSameOriginHealthCheck(){
  try{
    const r=await fetch('/api/health',{headers:{accept:'application/json'}});
    if(!r.ok) return false;
    const d=await r.json();
    return !!d?.ok;
  }catch{
    return false;
  }
}

document.addEventListener('DOMContentLoaded', async ()=>{
  chassSetVersionLabel('7.4');

  const sameOriginOk = await chassSameOriginHealthCheck();
  if(sameOriginOk){
    const input=$('narApiBase');
    if(input) input.value='';

    try{
      if(typeof saveNarApiBase==='function') saveNarApiBase('');
    }catch{}

    // Hide legacy URL setup controls, because API is served from same Worker.
    const ids=['narApiBase','saveNarApiBase','testNarApiBase'];
    ids.forEach(id=>{
      const el=$(id);
      if(!el) return;
      const wrap=el.closest('details,section,.card,.panel,.setting-row,.form-row') || el.parentElement;
      if(wrap) wrap.hidden=true;
      else el.hidden=true;
    });

    if(typeof setOfficialStatus==='function'){
      setOfficialStatus('NAR自動連携：同一Worker接続OK（API Ver.7.3）','ok');
    }
  }
});
