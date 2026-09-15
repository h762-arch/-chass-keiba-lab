import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const jra = await readFile(new URL('../jra-odds-client.js', import.meta.url), 'utf8');

test('app uses PREODDS-v1 and freezes the first complete market snapshot', () => {
  assert.match(app, /PREODDS_POLICY_VERSION='PREODDS-v1'/);
  assert.match(app, /preOddsFrozen=true|preOddsFrozen=alreadyFrozen\|\|stats\.complete/);
  assert.match(app, /marketRole=PREODDS_MARKET_ROLE/);
  assert.match(app, /事前オッズ（固定）/);
});

test('60-second odds polling is fully disabled', () => {
  assert.doesNotMatch(app, /setInterval\(\(\)=>syncLiveOdds\(true\),60000\)/);
  assert.match(app, /autoOddsState'\)\.textContent='固定運用'/);
  assert.match(html, /自動追跡なし/);
  assert.match(html, /id="autoOdds" type="checkbox" disabled/);
});

test('09:30 JST is a one-shot fallback and current odds stay outside app tracking', () => {
  assert.match(app, /PREODDS_FALLBACK_HOUR_JST=9,PREODDS_FALLBACK_MINUTE_JST=30/);
  assert.match(app, /T00:30:00\.000Z/);
  assert.match(html, /09:30 JSTに1回だけ確認/);
  assert.match(html, /現在オッズはチャス側Live Assessment/);
});

test('JRA client is one-shot pre-odds oriented', () => {
  assert.match(jra, /CHASS-JRA-PREODDS-FREEZE-v1/);
  assert.match(jra, /事前オッズを取得・固定/);
  assert.doesNotMatch(jra, /60秒/);
});
