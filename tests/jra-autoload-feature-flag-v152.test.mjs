import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('app enables existing JRA auto-fetch gate by default', () => {
  const app = fs.readFileSync('app.js', 'utf8');
  const client = fs.readFileSync('jra-race-client.js', 'utf8');

  assert.match(app, /CHASS-JRA-AUTO-LOAD-v1\.5\.2/);
  assert.match(app, /ENABLE_JRA_AUTO_FETCH==null/);
  assert.match(app, /ENABLE_JRA_AUTO_FETCH=true/);

  assert.match(client, /ENABLE_JRA_AUTO_FETCH===true/);
  assert.doesNotMatch(client, /scheduleAutoLoad/);
});

test('explicit false override remains possible', () => {
  const app = fs.readFileSync('app.js', 'utf8');
  assert.match(
    app,
    /if\(window\.CHASS_FEATURES\.ENABLE_JRA_AUTO_FETCH==null\)/
  );
});
