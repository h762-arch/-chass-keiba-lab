import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {dirname,resolve,relative,extname} from 'node:path';
import {fileURLToPath} from 'node:url';

// Read-only source inventory. No fetch, app execution, storage writes or feature changes.
// Literal dependency references approximate reachability; they do not prove execution.
export function auditAppArchitecture(root=resolve(dirname(fileURLToPath(import.meta.url)),'..')){
 const registry=JSON.parse(readFileSync(resolve(root,'config/app-feature-ownership-v1.json'),'utf8'));
 const tracked=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'})
  .split('\0').filter(Boolean);
 const files=new Set(tracked),sources=new Map(),graph=new Map(),missing=[];
 for(const p of files)if(['.js','.mjs','.html'].includes(extname(p)))sources.set(p,readFileSync(resolve(root,p),'utf8'));
 const add=(from,spec,kind)=>{
  if(!spec.startsWith('.')&&!spec.startsWith('/'))return;
  const target=relative(root,resolve(spec.startsWith('/')?root:dirname(resolve(root,from)),spec.replace(/^\//,''))).replaceAll('\\','/');
  if(!files.has(target)){missing.push({from,target,kind});return;}
  if(!graph.has(from))graph.set(from,new Set());graph.get(from).add(target);
 };
 for(const [p,source] of sources){
  if(p.endsWith('.html')){
   for(const m of source.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi))add(p,m[1],'html-script');
   continue;
  }
  for(const regex of [/^\s*import\s+(?:[^;'"`]*?\s+from\s*)?['"]([^'"]+)['"]/gm,
   /^\s*export\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/gm,
   /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g])
   for(const m of source.matchAll(regex))add(p,m[1],'literal-module-reference');
 }
 // This browser intentionally loads classic scripts in a declared ordered array.
 const bootstrap='src/prediction/jra-browser-bootstrap.mjs',text=sources.get(bootstrap)||'';
 const declared=text.match(/const scripts\s*=\s*\[([\s\S]*?)\];/)?.[1]||'';
 for(const m of declared.matchAll(/['"]([^'"]+\.js)['"]/g))add(bootstrap,m[1],'bootstrap-classic-script');
 const walk=entry=>{const seen=new Set(),queue=[entry];while(queue.length){const p=queue.pop();if(seen.has(p))continue;seen.add(p);queue.push(...graph.get(p)||[]);}return seen;};
 const lanes=Object.fromEntries(Object.entries(registry.entrypoints).map(([k,p])=>[k,walk(p)]));
 const features=registry.features.map(f=>({...f,declaredSourceLanes:Object.entries(lanes).filter(([,set])=>set.has(f.module)).map(([k])=>k)}));
 const violations=[];
 for(const f of features){
  if(!files.has(f.module))violations.push({id:f.id,reason:'MODULE_MISSING'});
  for(const lane of f.forbiddenRuntimeLanes||[])if(f.declaredSourceLanes.includes(lane))violations.push({id:f.id,lane,reason:'UNREVIEWED_RESEARCH_WIRING'});
 }
 const productionModules=[...sources.keys()].filter(p=>!p.includes('/')||p.startsWith('src/')).filter(p=>p.endsWith('.js')||p.endsWith('.mjs'));
 const runtimeMissing=missing.filter(x=>Object.values(lanes).some(set=>set.has(x.from)));
 return {schemaVersion:1,status:runtimeMissing.length||violations.length?'REVIEW_REQUIRED':'DECLARED_BOUNDARIES_MATCH',
  sourceCount:productionModules.length,predictionModules:productionModules.filter(p=>p.startsWith('src/prediction/')).length,
  researchModules:productionModules.filter(p=>p.startsWith('src/research/')).length,
  lanes:Object.fromEntries(Object.entries(lanes).map(([k,v])=>[k,[...v].sort()])),features,
  runtimeMissingReferences:runtimeMissing,
  allLiteralMissingReferences:missing,violations,
  limitations:['Literal references and the known bootstrap array only; comments may resemble imports.',
   'Reachability does not prove execution, API availability, feature enablement or semantic compatibility.',
   'CLI/VM/fs-loaded sources, nonliteral imports, conditional execution, assets and deployed env overrides require separate review.',
   'Unreachable modules are not declared dead or unused; do not auto-delete.'],
  formalKpi:'HOLD',probability:'MODEL_HOLD',productionActivation:'NO-GO'};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const report=auditAppArchitecture();process.stdout.write(JSON.stringify(report,null,2)+'\n');
 process.exitCode=report.violations.length||report.runtimeMissingReferences.length?1:0;
}
