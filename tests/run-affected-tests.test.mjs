import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,mkdirSync,rmSync,readFileSync,symlinkSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {planAffectedTests,collectChanges} from '../scripts/run-affected-tests.mjs';
const texts={'src/leaf.mjs':'export const value=1;','src/middle.mjs':"export {value} from './leaf.mjs';",'tests/leaf.test.mjs':"import '../src/leaf.mjs';",'tests/indirect.test.mjs':"import '../src/middle.mjs';",'tests/other.test.mjs':'// leaf.mjs is mentioned only in a comment'};
test('selects exact direct and transitive consumers, not comments or basename coincidences',()=>{const p=planAffectedTests(['src/leaf.mjs'],{...texts,'src/assert.mjs':'const require=(condition)=>{if(!condition)throw Error();}; require(true);'});assert.equal(p.mode,'targeted');assert.deepEqual(p.tests,['tests/indirect.test.mjs','tests/leaf.test.mjs']);});
test('a changed test is selected without running unrelated suites',()=>{assert.deepEqual(planAffectedTests(['tests/leaf.test.mjs'],texts).tests,['tests/leaf.test.mjs']);});
test('readFileSync and URL fixtures plus static dynamic imports are dependencies',()=>{const s={'app.js':'const app=1;','tests/a.test.mjs':"const p=new URL('../app.js',import.meta.url); readFileSync(p);",'tests/b.test.mjs':"await import('../app.js');"};assert.deepEqual(planAffectedTests(['app.js'],s).tests,['tests/a.test.mjs','tests/b.test.mjs']);});
test('cycles terminate while retaining indirect tests',()=>{const s={...texts,'src/leaf.mjs':"import './middle.mjs'; export const value=1;"};assert.equal(planAffectedTests(['src/leaf.mjs'],s).mode,'targeted');});
test('same basename in another directory cannot certify source coverage',()=>{const s={'src/a/item.mjs':'export const x=1;','src/b/item.mjs':'export const x=2;','tests/a.test.mjs':"import '../src/b/item.mjs';"};assert.equal(planAffectedTests(['src/a/item.mjs'],s).mode,'full');});
test('unknown code, configuration, workflow and policy changes require full check',()=>{for(const p of ['wrangler.jsonc','package.json','migrations/a.sql','.github/workflows/a.yml','AGENTS.md','scripts/run-affected-tests.mjs','index.html','styles.css','src/unknown.mjs'])assert.equal(planAffectedTests([p],texts).mode,'full',p);});
test('only known documentation paths can skip runtime checks',()=>{assert.equal(planAffectedTests(['docs/TEST_STRATEGY.md'],texts).mode,'docs-only');assert.equal(planAffectedTests(['README.md'],texts).mode,'docs-only');assert.equal(planAffectedTests(['scripts/runtime.txt'],texts).mode,'full');});
test('empty, large, deletion and unsafe changes cannot claim a narrow pass',()=>{assert.equal(planAffectedTests([],texts).mode,'full');assert.equal(planAffectedTests(Array.from({length:16},(_,i)=>`docs/a${i}.md`),texts).mode,'full');assert.equal(planAffectedTests(['src/leaf.mjs'],texts,{deleted:['src/old.mjs']}).mode,'full');for(const p of ['../x.js','/tmp/x.js','--import=bad.js','a\\b.js'])assert.equal(planAffectedTests([p],texts).mode,'full');});
test('unknown dynamic imports and parser failures fall back instead of skipping tests',()=>{assert.equal(planAffectedTests(['src/leaf.mjs'],{...texts,'src/loader.mjs':'await import(process.env.TARGET);'}).mode,'full');assert.equal(planAffectedTests(['src/leaf.mjs'],{...texts,'src/leaf.mjs':'export const = broken;'}).mode,'full');});
test('more than thirty affected tests require full check',()=>{const s={...texts};for(let i=0;i<31;i++)s[`tests/t${i}.test.mjs`]="import '../src/leaf.mjs';";assert.equal(planAffectedTests(['src/leaf.mjs'],s).mode,'full');});
function repo(fn){const dir=mkdtempSync(join(tmpdir(),'chass-scope-git-'));const git=(...a)=>execFileSync('git',a,{cwd:dir,encoding:'utf8'});try{git('init','-q');git('config','user.name','test');git('config','user.email','test@example.invalid');writeFileSync(join(dir,'a.mjs'),'export const a=1;');git('add','.');git('commit','-qm','base');fn({dir,git});}finally{rmSync(dir,{recursive:true,force:true});}}
test('working mode includes staged, unstaged and untracked changes',()=>repo(({dir,git})=>{writeFileSync(join(dir,'a.mjs'),'export const a=2;');git('add','a.mjs');writeFileSync(join(dir,'b.mjs'),'export const b=1;');assert.deepEqual(collectChanges(dir,'--working').paths.sort(),['a.mjs','b.mjs']);}));
test('deletions and both sides of rename are retained for full fallback',()=>repo(({dir,git})=>{git('mv','a.mjs','new.mjs');const d=collectChanges(dir,'--working');assert.ok(d.paths.includes('a.mjs'));assert.ok(d.paths.includes('new.mjs'));assert.deepEqual(d.deleted,['a.mjs']);}));
test('staged validation rejects unstaged overrides of the intended patch',()=>repo(({dir,git})=>{writeFileSync(join(dir,'a.mjs'),'export const a=2;');git('add','a.mjs');writeFileSync(join(dir,'a.mjs'),'export const a=3;');assert.throws(()=>collectChanges(dir,'--staged'),/Unstaged/);}));
test('invalid mode is rejected and staged paths are exact',()=>repo(({dir,git})=>{assert.throws(()=>collectChanges(dir,'--other'),/Usage/);writeFileSync(join(dir,'space name.mjs'),'export const x=1;');git('add','.');assert.deepEqual(collectChanges(dir,'--staged').paths,['space name.mjs']);}));
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('npm default is scoped while full check and deploy remain full',()=>{const p=JSON.parse(read('package.json'));assert.equal(p.scripts.test,'node scripts/run-affected-tests.mjs --working');assert.match(p.scripts['test:full'],/node --test regression\.test\.mjs tests\/\*\.test\.mjs/);assert.match(p.scripts.check,/node --test regression\.test\.mjs tests\/\*\.test\.mjs/);assert.match(read('.github/workflows/finalize-deploy.yml'),/Run full regression check\s+run: npm run check/);});

function cliFixture(fn){repo(({dir,git})=>{
 mkdirSync(join(dir,'scripts'));mkdirSync(join(dir,'tests'));mkdirSync(join(dir,'node_modules'));
 writeFileSync(join(dir,'scripts/run-affected-tests.mjs'),read('scripts/run-affected-tests.mjs'));
 symlinkSync(new URL('../node_modules/acorn',import.meta.url).pathname,join(dir,'node_modules/acorn'),'dir');
 writeFileSync(join(dir,'.gitignore'),'node_modules/\ntrace.txt\n');
 writeFileSync(join(dir,'package.json'),JSON.stringify({type:'module',scripts:{check:'node full.mjs'}}));
 writeFileSync(join(dir,'full.mjs'),"import {writeFileSync} from 'node:fs';writeFileSync('trace.txt','full');process.exit(Number(process.env.FULL_FAIL||0));");
 writeFileSync(join(dir,'tests/a.test.mjs'),"import {a} from '../a.mjs';import assert from 'node:assert/strict';assert.equal(a,1);");
 git('add','.');git('commit','-qm','harness');
 const cliEnv={...process.env,GITHUB_STEP_SUMMARY:''};delete cliEnv.NODE_TEST_CONTEXT;
 const run=(...args)=>spawnSync(process.execPath,['scripts/run-affected-tests.mjs',...args],{cwd:dir,encoding:'utf8',env:cliEnv});
 fn({dir,git,run});
});}
test('real CLI executes focused tests and propagates their failure',()=>cliFixture(({dir,run})=>{writeFileSync(join(dir,'a.mjs'),'export const a=2;');const r=run('--working');assert.equal(r.status,1,r.stdout+r.stderr);assert.match(r.stdout,/"mode": "targeted"/);assert.equal(existsSync(join(dir,'trace.txt')),false);assert.doesNotMatch(r.stdout,/PASS scope=/);}));
test('real CLI catches untracked code and runs full fallback rather than empty success',()=>cliFixture(({dir,run})=>{writeFileSync(join(dir,'unknown.mjs'),'export const unknown=1;');const r=run('--working');assert.equal(r.status,0,r.stdout+r.stderr);assert.match(r.stdout,/"mode": "full"/);assert.equal(readFileSync(join(dir,'trace.txt'),'utf8'),'full');}));
test('real CLI documentation check runs no tests and staged mismatch fails closed',()=>cliFixture(({dir,git,run})=>{mkdirSync(join(dir,'docs'));writeFileSync(join(dir,'docs/a.md'),'text');const r=run('--working');assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/"mode": "docs-only"/);assert.equal(existsSync(join(dir,'trace.txt')),false);writeFileSync(join(dir,'a.mjs'),'export const a=2;');git('add','a.mjs');writeFileSync(join(dir,'a.mjs'),'export const a=3;');assert.equal(run('--staged').status,1);}));
