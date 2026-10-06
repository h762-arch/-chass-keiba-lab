import {pathToFileURL} from 'node:url';
import {loadVerifiedFrozenSignalComparison} from './verify-frozen-signal-comparison.mjs';
const cell=v=>String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
 .replace(/[\\|`*_\[\]#]/g,'\\$&').replace(/[\r\n]/g,' ');
const metric=(hits,count)=>count?`${hits}/${count} (${(100*hits/count).toFixed(2)}%)`:'0/0 (未観測)';

// Use the replay already verified in memory; do not reread comparison.json after verification.
// stdout Markdown on success; rejected requests have no report and emit diagnostics on stderr.
export async function runFrozenSignalReportCli(args){
 const verified=await loadVerifiedFrozenSignalComparison(args);
 if(verified.status!=='VERIFIED')return {...verified,report:null};
 const c=verified.comparison,s=c.summary;
 const lines=['# Original Signal 研究比較レポート','',
  '判定範囲：ローカル入力からの再現性確認（VERIFIED）。取得元の真正性・Production実測の証明ではありません。',
  'Production Activation：NO-GO。正式KPI対象：false。予想段階：SIGNAL_FREEZE。シナリオ品質：NOT_EVALUATED。','',
  `検証時刻：${cell(c.evaluationNow)}（UTC）`,
  `入力の由来：${c.inputProvenance}`,
  `比較終了コード：${verified.comparisonExitCode}（0：除外なしで観測あり、2：除外ありまたは観測なし）`,'',
  '## 観測と除外','',
  '| 項目 | 件数 |','| --- | ---: |',
  `| 対象レース | ${s.requestedRaceCount} |`,
  `| 比較監査済みレース | ${s.auditedRaceCount} |`,
  `| 観測馬のあるレース | ${s.observedRaceCount} |`,
  `| 除外レース（未取得を含む） | ${s.excludedRaceCount} |`,
  `| 公式結果未取得レース（除外の内数） | ${s.pendingRaceCount} |`,
  `| 観測馬 | ${s.observedHorseCount} |`,
  `| 除外馬（比較監査済みレース内） | ${s.excludedHorseCount} |`,'',
  '## 印別集計','',
  '分母は各印の観測馬数。未取得・除外は不的中として数えません。分母0は未観測です。',
  '💎の目標は2〜3着、💎💎/💎💎💎は1着、⚠️は3着以内に入らないことです。',
  '⚠️の強度は統合しています。少数標本の割合から将来成績を断定しないでください。','',
  '| 印 | 観測馬 | 観測レース | 目標的中/分母 | 1着/分母 | 3着以内/分母 |',
  '| --- | ---: | ---: | --- | --- | --- |'];
 for(const g of s.groups)lines.push(`| ${g.mark} | ${g.observedHorseCount} | ${g.observedRaceCount} | ${metric(g.scenarioHits,g.observedHorseCount)} | ${metric(g.winHits,g.observedHorseCount)} | ${metric(g.top3Hits,g.observedHorseCount)} |`);
 lines.push('','## レースの除外・未取得','');
 if(!s.excludedRaces.length)lines.push('なし。');
 else{
  lines.push('| レースID | 状態 | 理由 |','| --- | --- | --- |');
  for(const r of s.excludedRaces)lines.push(`| ${cell(r.raceId)} | ${cell(r.status)} | ${cell(r.reason)} |`);
 }
 lines.push('','## 馬の除外','');
 if(!s.excludedHorses.length)lines.push('なし。');
 else{
  lines.push('| レースID | 馬番 | 理由 | 詳細 |','| --- | ---: | --- | --- |');
  for(const h of s.excludedHorses)lines.push(`| ${cell(h.raceId)} | ${h.horseNo} | ${cell(h.reason)} | ${cell((h.reasons??[]).join(', '))} |`);
 }
 lines.push('','## 読取診断','');
 if(!c.readerExclusions.length)lines.push('なし。');
 else for(const r of c.readerExclusions)lines.push(`- ${cell(r.raceId)}：${cell(r.reason)}`);
 lines.push('','## 入力の同一性','',`backup SHA-256：${c.backupSha256}`,`cache SHA-256：${c.cacheSha256}`,
  '', '対象レースID：','');
 for(const id of c.requestedRaceIds)lines.push(`- ${cell(id)}`);
 lines.push('','このレポートは回収率・ROI・シナリオの質・正式EARLY印との同一性を評価しません。');
 return {status:'READY',reason:null,comparisonExitCode:verified.comparisonExitCode,
  formalKpiEligible:false,productionActivationReady:false,report:lines.join('\n')+'\n'};
}
// node scripts/report-frozen-signals.mjs --backup backup.json --cache cache.json --comparison comparison.json > report.md
// exit 0 complete comparison, 2 reproducible but incomplete, 1 rejected (stdout empty).
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 const result=await runFrozenSignalReportCli(process.argv.slice(2));
 if(result.status==='READY'){process.stdout.write(result.report);process.exitCode=result.comparisonExitCode;}
 else{console.error(JSON.stringify(result));process.exitCode=1;}
}
