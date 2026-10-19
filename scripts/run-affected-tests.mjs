/** Conservative change checks. Final integration and production use npm run check. */
import {execFileSync,spawnSync} from 'node:child_process';
import {readFileSync,existsSync,appendFileSync} from 'node:fs';
import {resolve,posix} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from 'acorn';
const root=fileURLToPath(new URL('../',import.meta.url));
const CODE=/\.(?:mjs|cjs|js)$/;
const TEST=/^(?:regression\.test\.mjs|tests\/(?!fixtures\/).+\.test\.mjs)$/;
const DOC=/^(?:README\.md|docs\/.+\.(?:md|txt))$/i;
const full=reason=>({mode:'full',reason,tests:[],syntaxFiles:[]});
const safe=p=>typeof p==='string'&&p.length>0&&!p.startsWith('-')&&!p.startsWith('/')&&!p.split('/').some(x=>!x||x==='.'||x==='..')&&!/[\\\u0000-\u001f]/.test(p);
function walk(node,visit){if(!node||typeof node!=='object')return;visit(node);for(const [k,v] of Object.entries(node)){if(k==='type'||k==='start'||k==='end')continue;if(Array.isArray(v))v.forEach(x=>walk(x,visit));else if(v&&typeof v==='object')walk(v,visit);}}
function references(path,text,known){
 let ast;try{ast=parse(text,{ecmaVersion:'latest',sourceType:path.endsWith('.cjs')?'commonjs':'module',allowHashBang:true});}catch{return {invalid:true,refs:new Set(),dynamic:false};}
 const refs=new Set();let dynamic=false;
 const commonJs=path.endsWith('.cjs')||text.includes('createRequire');
 const add=value=>{if(typeof value!=='string')return;const s=value.split(/[?#]/)[0];for(const candidate of [posix.normalize(s),posix.normalize(posix.join(posix.dirname(path),s))])if(known.has(candidate))refs.add(candidate);};
 walk(ast,node=>{
  if(node.type==='Literal')add(node.value);
  if(node.type==='TemplateLiteral'&&node.expressions.length===0)add(node.quasis[0].value.cooked);
  if(node.type==='ImportExpression'&&!(node.source.type==='Literal'&&typeof node.source.value==='string'))dynamic=true;
  if(commonJs&&node.type==='CallExpression'&&node.callee?.type==='Identifier'&&node.callee.name==='require'&&!(node.arguments[0]?.type==='Literal'&&typeof node.arguments[0].value==='string'))dynamic=true;
 });
 return {refs,dynamic,invalid:false};
}
export function planAffectedTests(changedPaths,sourceTexts={},options={}){
 const paths=[...new Set(changedPaths)].sort();
 if(!paths.length)return full('No diff: run the full suite explicitly instead of claiming an empty pass.');
 if(paths.some(p=>!safe(p)))return full('Unsafe or unsupported path.');
 if(paths.length>15)return full('Large change set (>15 files).');
 if(options.deleted?.length)return full('Deleted or renamed files require full validation.');
 if(paths.some(p=>p==='AGENTS.md'||p==='scripts/run-affected-tests.mjs'||p.startsWith('.github/')||p.startsWith('migrations/')||!CODE.test(p)&&!DOC.test(p)))return full('Workflow, policy, configuration, asset or unknown change.');
 const code=paths.filter(p=>CODE.test(p));
 if(!code.length)return {mode:'docs-only',reason:'Documentation only.',tests:[],syntaxFiles:[]};
 if(code.some(p=>!Object.hasOwn(sourceTexts,p)))return full('Changed source missing from dependency inventory.');
 const known=new Set(Object.keys(sourceTexts)),graph=new Map();
 for(const [p,text] of Object.entries(sourceTexts)){
  if(!CODE.test(p)||p.startsWith('tests/fixtures/'))continue;
  graph.set(p,references(p,text,known));
 }
 // A non-literal loader has an unknown target: never infer safety from a filename match.
 if(code.some(p=>!TEST.test(p))&&[...graph.values()].some(x=>x.dynamic))return full('Non-literal module loading has unknown impact.');
 const impacted=new Set(code);let again=true;
 while(again){again=false;for(const [p,g] of graph)if(!impacted.has(p)&&[...g.refs].some(x=>impacted.has(x))){impacted.add(p);again=true;}}
 if([...impacted].some(p=>graph.get(p)?.invalid)||code.some(p=>!TEST.test(p))&&[...graph.values()].some(x=>x.invalid))return full('Unable to parse affected JavaScript.');
 const tests=[...impacted].filter(p=>TEST.test(p)).sort();
 for(const p of code){const seen=new Set([p]);let more=true;while(more){more=false;for(const [q,g] of graph)if(!seen.has(q)&&[...g.refs].some(x=>seen.has(x))){seen.add(q);more=true;}}if(![...seen].some(q=>TEST.test(q)))return full(`No verified test consumer for ${p}.`);}
 if(tests.length>30)return full('Broad dependency impact (>30 test files).');
 return {mode:'targeted',reason:'Exact file references and transitive consumers selected.',tests,syntaxFiles:code};
}
const git=(cwd,args)=>execFileSync('git',args,{cwd,encoding:'utf8'}).split('\0').filter(Boolean);
function changes(cwd,cached){const a=git(cwd,['diff',...(cached?['--cached']:[]),'--name-status','--no-renames','-z']);const out=[];for(let i=0;i<a.length;i+=2)out.push({status:a[i],path:a[i+1]});return out;}
export function collectChanges(cwd,mode){
 if(!['--staged','--working'].includes(mode))throw Error('Usage: node scripts/run-affected-tests.mjs --staged|--working [--plan]');
 const unstaged=changes(cwd,false),staged=changes(cwd,true);
 if(mode==='--staged'&&unstaged.length)throw Error('Unstaged changes present: stage the intended patch before staged validation.');
 const untracked=mode==='--working'?git(cwd,['ls-files','--others','--exclude-standard','-z']).map(path=>({status:'A',path})):[];
 const entries=mode==='--staged'?staged:[...staged,...unstaged,...untracked];
 return {paths:[...new Set(entries.map(x=>x.path))],deleted:entries.filter(x=>x.status==='D').map(x=>x.path)};
}
function run(program,args){const r=spawnSync(program,args,{cwd:root,stdio:'inherit',env:process.env});if(r.error)throw r.error;if(r.status!==0)throw Object.assign(Error(`${program} failed`),{exitCode:r.status??1});}
function main(){
 const args=process.argv.slice(2);if(args.length>2||args.length===2&&args[1]!=='--plan')throw Error('Invalid arguments.');
 const delta=collectChanges(root,args[0]);const inventory=[...new Set([...git(root,['ls-files','-z']),...delta.paths])].filter(p=>safe(p)&&CODE.test(p)&&existsSync(resolve(root,p)));
 const texts=Object.fromEntries(inventory.map(p=>[p,readFileSync(resolve(root,p),'utf8')]));
 const plan=planAffectedTests(delta.paths,texts,{deleted:delta.deleted});
 console.log(JSON.stringify({changedPaths:delta.paths,...plan},null,2));
 if(args.includes('--plan'))return;
 // Publish the exact scope before running; any failing command still fails the job.
 if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,`\n### Change validation scope\n- Mode: ${plan.mode}\n- Reason: ${plan.reason.replace(/[\r\n`]/g,' ')}\n- Selected test files: ${plan.tests.length}\n- Full integration remains required before merge.\n`);
 if(plan.mode==='full')run('npm',['run','check']);
 else if(plan.mode==='targeted'){for(const p of plan.syntaxFiles)run(process.execPath,['--check',p]);run(process.execPath,['--test',...plan.tests.map(p=>'./'+p)]);}
 console.log(`[CHASS] PASS scope=${plan.mode}; full integration and pre-deploy checks remain mandatory.`);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{main();}catch(e){console.error(e.message);process.exitCode=e.exitCode||1;}}
