import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
const root=new URL('../',import.meta.url);
// Cloudflare .assetsignore uses gitignore syntax. Test the effective rules, including negation.
function boundary(check){
 const dir=mkdtempSync(join(tmpdir(),'chass-assets-'));
 try{
  execFileSync('git',['init','--quiet',dir]);
  writeFileSync(join(dir,'.gitignore'),readFileSync(new URL('.assetsignore',root)));
  const ignored=path=>{
   const result=spawnSync('git',['-c','core.excludesFile=/dev/null','check-ignore','--no-index','--quiet',path],{cwd:dir});
   assert.ok(result.status===0||result.status===1,result.stderr?.toString());return result.status===0;
  };
  check(ignored);
 }finally{rmSync(dir,{recursive:true,force:true});}
}
test('HTML module entry and its module dependencies are included in public assets',()=>{
 boundary(ignored=>{
  const html=readFileSync(new URL('index.html',root),'utf8');
  const entry=/<script type="module" src="\/([^\"]+)"/.exec(html)?.[1];assert.ok(entry);
  const queue=[entry],seen=new Set();
  while(queue.length){
   const path=queue.shift();if(seen.has(path))continue;seen.add(path);
   assert.equal(ignored(path),false,`${path} would return 404 after deployment`);
   const source=readFileSync(new URL(path,root),'utf8');
   for(const match of source.matchAll(/\bfrom\s+['"]([^'"]+\.mjs)['"]/g)){
    const dep=new URL(match[1],new URL(path,root));queue.push(dep.pathname.slice(root.pathname.length));
   }
  }
  assert.equal(seen.size,3);
 });
});
test('server modules, credentials configuration, research tooling and future modules remain excluded',()=>{
 boundary(ignored=>{
  for(const path of ['worker.js','worker-entry.mjs','server.mjs','wrangler.jsonc','package.json',
   'mcp/server.mjs','scripts/import-frozen-signal-cache.mjs','tests/browser-asset-boundary.test.mjs',
   'src/research/jra-signal-outcome-reader.mjs','src/prediction/background-precompute.mjs',
   'src/prediction/future-internal.mjs','migrations/example.sql','.git/config','.github/workflows/example.yml'])
   assert.equal(ignored(path),true,`${path} must not be public`);
 });
});
test('classic browser scripts remain included without widening the module allowlist',()=>{
 boundary(ignored=>{
  for(const path of ['index.html','app.js','jra-normalizer.js','jra-model.js','jra-adapter.js',
   'src/research/longshot-scenario.js','jra-result-client.js'])assert.equal(ignored(path),false,path);
  const exceptions=readFileSync(new URL('.assetsignore',root),'utf8').split('\n').filter(line=>line.startsWith('!'));
  assert.deepEqual(exceptions,['!/src/prediction/jra-browser-bootstrap.mjs','!/src/prediction/jra-ability-core.mjs',
   '!/src/prediction/jra-ability-result-projector.mjs']);
 });
});
