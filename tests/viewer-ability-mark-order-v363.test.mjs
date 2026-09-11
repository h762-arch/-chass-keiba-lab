import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../viewer/viewer-app.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../viewer/viewer.css', import.meta.url), 'utf8');

test('v3.6.3 separates ability and rank', () => {
  assert.match(app, /viewer-ability-panel/);
  assert.match(app, /viewer-ability-score/);
  assert.match(app, /viewer-ability-rank/);
  assert.match(app, /scoreLabel\.textContent = '能力'/);
  assert.match(app, /rankLabel\.textContent = '順位'/);
  assert.match(css, /\.viewer-ability-panel/);
});

test('v3.6.3 expands marks in ○ then ▲ then △ order', () => {
  const o = app.indexOf("['○', 0]");
  const tri = app.indexOf("['▲', 1]");
  const delta = app.indexOf("['△', 2]");
  assert.ok(o >= 0);
  assert.ok(tri > o);
  assert.ok(delta > tri);
});
