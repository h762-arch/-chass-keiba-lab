import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {VERSION as workerVersion} from '../worker.js';

test('UI, Worker and package versions match',async()=>{
  const [app,index,packageText]=await Promise.all([readFile(new URL('../app.js',import.meta.url),'utf8'),readFile(new URL('../index.html',import.meta.url),'utf8'),readFile(new URL('../package.json',import.meta.url),'utf8')]);
  const pkg=JSON.parse(packageText);
  const appVersion=app.match(/APP_VERSION='([^']+)'/)?.[1];
  const htmlVersion=index.match(/Ver\.([0-9.]+)/)?.[1];
  assert.equal(appVersion,pkg.version);
  assert.equal(workerVersion,pkg.version);
  assert.equal(htmlVersion,pkg.version);
});
