import {createWaveArtifact,createWaveBatch,saveWaveArtifact,verifyWaveArtifact} from './wave-analysis-v1.mjs';
const $=id=>document.getElementById(id);
let artifact=null,generation=0,exportArtifacts=[];
const labels={FULL_CANONICAL:'契約の全成分',AVAILABLE_WEIGHT_CURRENT:'利用可能成分',MARKET_ONLY_CURRENT:'市場のみ',STRUCTURE_ONLY_CURRENT:'構造のみ',HISTORICAL_PRIOR:'PRIOR・互換履歴の中央値',COLD_START_NEUTRAL:'COLD_START・表示用中立値'};
function refreshSaved(){
 const select=$('waveAnalysisSaved');if(!select)return;
 select.replaceChildren();const first=document.createElement('option');first.value='';first.textContent='保存済み分析を選択';select.append(first);
 try{for(let i=0;i<localStorage.length;i++){
  const key=localStorage.key(i);if(!key?.startsWith('CHASS_WAVE_RESEARCH_V1:'))continue;
  const data=JSON.parse(localStorage.getItem(key));const option=document.createElement('option');option.value=key;option.textContent=`${data?.body?.result?.raceId??'識別未確認'}｜${data?.body?.analyzedAt??''}`;select.append(option);
 }}catch{$('waveAnalysisStatus').textContent='保存済み分析の一覧を読めません。';}
}
function render(result){
 const box=$('waveAnalysisOutput');if(!box)return;
 box.replaceChildren();if(!result)return;
 const put=(tag,text)=>{const e=document.createElement(tag);e.textContent=text;box.append(e);};
 const op=result.operational,c=result.canonical;
 put('h3',op?.score==null?'波乱度：入力回復待ち':`波乱度 ${op.score} / 100｜${op.class}`);
 put('p',op?.mode?`${labels[op.mode]}｜信頼区分 ${op.confidence}`:'合法な計算入力・履歴を確認できていません。');
 if(op?.mode==='COLD_START_NEUTRAL')put('p','この50は当該レースの波乱判定ではありません。表示用の中立値です。');
 if(op?.mode==='HISTORICAL_PRIOR')put('p','当該レースの観測値ではありません。');
 put('p',`研究用Canonical：${c?.score??'未算出'}｜SC ${c?.structuralChaos??'未取得'}／MC ${c?.marketChaos??'未取得'}`);
 put('p',`市場 ${result.quality?.sourceClass??'UNKNOWN'}｜成分充足 ${Number(result.quality?.dataCoveragePct??0).toFixed(1)}%（的中確率ではありません）`);
 put('p','人気薄勝利リスク：未判定｜相手穴侵入リスク：未判定（Role契約の入力が必要）');
 put('p',`全馬Context：${result.runnerContexts?.length??0}頭｜${result.raceId??''}`);
 if(result.quality?.reasons?.length)put('p','不足・確認事項：'+result.quality.reasons.join(' / '));
 put('small','SHADOW・出所の独立認証なし。既存EARLY・印・確率・💎／⚠️・D1は変更しません。');
}
async function analyze(root,priors=null){
 const token=++generation;delete $('waveAnalysisStatus').dataset.artifactKey;$('waveAnalysisStatus').textContent='入力を照合・計算しています…';
 try{
  const next=await createWaveArtifact(root,{priors});if(token!==generation)return;
  artifact=next;exportArtifacts=[next];render(next.body.result);
  const saved=await saveWaveArtifact(localStorage,next);if(token!==generation)return;
  $('waveAnalysisStatus').textContent=next.body.result.status==='ANALYSIS_TERMINAL'?'研究用分析・端末保存・読戻し確認完了。':'入力回復待ちの状態を端末へ保存・読戻し確認済み。';
  $('waveAnalysisStatus').dataset.artifactKey=saved.key;refreshSaved();
 }catch(e){if(token===generation){artifact=null;render(null);$('waveAnalysisStatus').textContent='未完了｜'+e.message;}}
}
export function installWaveAnalysisUi(){
 if(!$('waveAnalyze'))return;
 refreshSaved();
 $('waveAnalysisSaved').onchange=async event=>{
  const key=event.target.value;if(!key)return;const token=++generation;
  try{const restored=JSON.parse(localStorage.getItem(key)||'null');await verifyWaveArtifact(restored);if(token!==generation)return;artifact=restored;exportArtifacts=[restored];render(restored.body.result);$('waveAnalysisStatus').textContent='保存済み研究分析を読戻し・再検証済み。Original EARLYは変更していません。';}
  catch(e){if(token===generation){artifact=null;render(null);$('waveAnalysisStatus').textContent='復元未完了｜'+e.message;}}
 };

 $('waveAnalyze').onclick=()=>{const root=window.CHASS_WAVE_INPUT?.();if(!root){$('waveAnalysisStatus').textContent='事前入力JSONを読み込んでください。';return;}analyze(root);};
 $('waveAnalysisFile').onchange=async event=>{const file=event.target.files?.[0];event.target.value='';if(!file)return;const token=++generation;
  try{if(file.size>2097152)throw Error('2MiB以下のJSONを選んでください。');const text=await file.text();if(token!==generation)return;const input=JSON.parse(text.replace(/^\uFEFF/,''));
   if(input.format==='CHASS_WAVE_INPUT_BUNDLE_V1'||input.format==='CHASS_WAVE_RESEARCH_BUNDLE_V1'){
    const rows=input.format==='CHASS_WAVE_INPUT_BUNDLE_V1'?await createWaveBatch(input.sources):null;
    if(token!==generation)return;
    const artifacts=rows?rows.filter(r=>r.artifact).map(r=>r.artifact):input.artifacts;
    if(!Array.isArray(artifacts)||artifacts.length>24)throw Error('WAVE_BATCH_COUNT_INVALID');
    let saved=0;const failed=rows?.filter(r=>r.error).map(r=>`入力${r.index+1}: ${r.error}`)||[];
    exportArtifacts=[];artifact=null;
    for(const item of artifacts){if(token!==generation)return;try{await verifyWaveArtifact(item);await saveWaveArtifact(localStorage,item);exportArtifacts.push(item);artifact=item;saved++;}catch(e){failed.push(e.message);}}
    if(token!==generation)return;
    render(artifact?.body.result);refreshSaved();
    $('waveAnalysisStatus').textContent=`一括処理：読戻し確認 ${saved}件／未完了 ${failed.length}件。回復待ちは各分析内に保持。`+(failed.length?' '+failed.join(' / '):'');
   }else if(input.format==='CHASS_WAVE_RESEARCH_ARTIFACT_V1'){
    await verifyWaveArtifact(input);if(token!==generation)return;await saveWaveArtifact(localStorage,input);if(token!==generation)return;artifact=input;exportArtifacts=[input];render(input.body.result);refreshSaved();$('waveAnalysisStatus').textContent='保存済み研究結果を読戻し・再検証しました。現在時点のPRE取得には昇格しません。';
   }else{await analyze(input.input??input,input.priors??null);}
  }catch(e){if(token===generation){artifact=null;render(null);$('waveAnalysisStatus').textContent='未完了｜'+e.message;}}
 };
 $('waveAnalysisExport').onclick=()=>{
  if(!artifact){$('waveAnalysisStatus').textContent='出力できる分析がありません。';return;}
  const output=exportArtifacts.length>1?{format:'CHASS_WAVE_RESEARCH_BUNDLE_V1',artifacts:exportArtifacts}:artifact;
  const url=URL.createObjectURL(new Blob([JSON.stringify(output,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=`CHASS_WAVE_${artifact.body.result.raceId.replaceAll('|','_')}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 };
 let contextKey=null;
 window.CHASS_WAVE_CONTEXT_CHANGED=key=>{if(contextKey!==null&&contextKey!==key)window.CHASS_WAVE_RESET?.();contextKey=key;};
 // Race changes and reloads must never display a different race's previous analysis.
 window.CHASS_WAVE_RESET=()=>{generation++;artifact=null;exportArtifacts=[];delete $('waveAnalysisStatus').dataset.artifactKey;render(null);$('waveAnalysisStatus').textContent='対象を変更しました。分析済みJSONは再読込で復元できます。';};
}
