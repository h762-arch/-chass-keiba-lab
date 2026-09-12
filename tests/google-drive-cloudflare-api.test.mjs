import test from 'node:test';
import assert from 'node:assert/strict';

import {
  handleDriveReadBridge,
  handleDriveReadHealth,
} from '../google-drive-readonly-api.mjs';

test('public Drive health fails closed when runtime is disabled', async () => {
  const response = await handleDriveReadHealth(
    new Request('https://example.test/api/drive-read/health'),
    {},
  );
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.enabled, false);
  assert.equal(body.spreadsheetReachable, false);
  assert.equal(JSON.stringify(body).includes('PRIVATE KEY'), false);
});

test('public Drive health rejects mutation methods', async () => {
  const response = await handleDriveReadHealth(
    new Request('https://example.test/api/drive-read/health', {
      method: 'POST',
    }),
    {},
  );
  assert.equal(response.status, 405);
});

test('protected Drive bridge requires JRA/NAR and Sheet after runtime readiness', async () => {
  const response = await handleDriveReadBridge(
    new Request(
      'https://example.test/api/chass/v1/drive?organization=UNKNOWN&sheet=anything',
    ),
    {},
  );
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.error, 'drive_read_not_configured');
});

test('runtime API source contains no Drive/Sheets mutation operations', async () => {
  const fs = await import('node:fs');
  const text = fs.readFileSync('google-drive-readonly-api.mjs', 'utf8');
  for (const pattern of [
    /values:append/i,
    /:batchUpdate/i,
    /drive\.files\.create/i,
    /drive\.files\.update/i,
    /drive\.files\.delete/i,
    /\.prepare\(/i,
    /\.run\(/i,
  ]) {
    assert.equal(pattern.test(text), false, `forbidden marker: ${pattern}`);
  }
});
