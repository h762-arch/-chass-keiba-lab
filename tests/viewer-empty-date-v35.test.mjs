import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('v3.5 empty-date UI uses one clean state and disables unavailable actions', () => {
  const app = fs.readFileSync(new URL('../viewer/viewer-app.js', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../viewer/viewer.css', import.meta.url), 'utf8');

  assert.match(app, /保存データなし/);
  assert.match(app, /この日の保存済み予想はありません/);
  assert.match(app, /最新 \$\{latest\.date\} \$\{latest\.track\} を見る/);
  assert.match(app, /elements\.track\.disabled = true/);
  assert.match(app, /elements\.submit\.disabled = true/);
  assert.match(app, /noDataState \? '予想なし' : '予想を表示'/);
  assert.doesNotMatch(app, /保存済み予想はまだありません/);

  assert.match(css, /\.viewer-no-data/);
  assert.match(css, /\.viewer-availability-button\.is-primary/);
});
