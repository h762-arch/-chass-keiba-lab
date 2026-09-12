import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CHASS_DRIVE_SHEET_ALLOWLIST,
  assertAllowedSheet,
  driveReadImportEnabled,
  getDriveReadReadiness,
  readChassArchiveSheet,
  refreshGoogleReadAccessToken,
  valuesToRecords,
} from '../google-drive-readonly-import.mjs';

const COMPLETE_ENV = Object.freeze({
  ENABLE_DRIVE_READ_IMPORT: 'true',
  CHASS_DRIVE_SPREADSHEET_ID: 'sheet-123',
  GOOGLE_DRIVE_READ_CLIENT_ID: 'client-id',
  GOOGLE_DRIVE_READ_CLIENT_SECRET: 'client-secret',
  GOOGLE_DRIVE_READ_REFRESH_TOKEN: 'refresh-token',
});

test('Drive read import defaults disabled', () => {
  assert.equal(driveReadImportEnabled({}), false);
  assert.equal(driveReadImportEnabled({ ENABLE_DRIVE_READ_IMPORT: 'false' }), false);
  assert.equal(driveReadImportEnabled({ ENABLE_DRIVE_READ_IMPORT: 'true' }), true);
});

test('readiness reports missing credentials without exposing values', () => {
  const readiness = getDriveReadReadiness({
    ENABLE_DRIVE_READ_IMPORT: 'true',
    CHASS_DRIVE_SPREADSHEET_ID: 'sheet-123',
  });

  assert.equal(readiness.enabled, true);
  assert.equal(readiness.configured, false);
  assert.deepEqual(readiness.missing.sort(), [
    'GOOGLE_DRIVE_READ_CLIENT_ID',
    'GOOGLE_DRIVE_READ_CLIENT_SECRET',
    'GOOGLE_DRIVE_READ_REFRESH_TOKEN',
  ].sort());
  assert.equal(JSON.stringify(readiness).includes('sheet-123'), false);
});

test('JRA and NAR sheet allowlists remain isolated', () => {
  const jra = CHASS_DRIVE_SHEET_ALLOWLIST.JRA[0];
  const nar = CHASS_DRIVE_SHEET_ALLOWLIST.NAR[0];

  assert.deepEqual(assertAllowedSheet(jra, 'JRA'), {
    organization: 'JRA',
    sheetTitle: jra,
  });

  assert.deepEqual(assertAllowedSheet(nar, 'NAR'), {
    organization: 'NAR',
    sheetTitle: nar,
  });

  assert.throws(() => assertAllowedSheet(nar, 'JRA'), {
    code: 'DRIVE_READ_SHEET_NOT_ALLOWLISTED',
  });

  assert.throws(() => assertAllowedSheet(jra, 'NAR'), {
    code: 'DRIVE_READ_SHEET_NOT_ALLOWLISTED',
  });
});

test('legacy common sheets are denied', () => {
  assert.throws(() => assertAllowedSheet('CHASS指数マスター'), {
    code: 'DRIVE_READ_LEGACY_SHEET_DENIED',
  });
});

test('valuesToRecords preserves null-like absence as empty values and de-duplicates headers', () => {
  const converted = valuesToRecords([
    ['馬番', '馬名', '馬名'],
    [1, 'テストA', '別名A'],
    [2, 'テストB'],
    ['', '', ''],
  ]);

  assert.deepEqual(converted.headers, ['馬番', '馬名', '馬名__2']);
  assert.equal(converted.records.length, 2);
  assert.deepEqual(converted.records[0], {
    馬番: 1,
    馬名: 'テストA',
    馬名__2: '別名A',
  });
  assert.deepEqual(converted.records[1], {
    馬番: 2,
    馬名: 'テストB',
    馬名__2: '',
  });
});

test('OAuth refresh uses POST only for token exchange', async () => {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET' });
    return new Response(JSON.stringify({
      access_token: 'access-token',
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const token = await refreshGoogleReadAccessToken(COMPLETE_ENV, { fetcher });
  assert.equal(token.accessToken, 'access-token');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.match(calls[0].url, /oauth2\.googleapis\.com\/token/);
});

test('sheet data path uses Google Sheets GET and never writes', async () => {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    const call = { url: String(url), method: init.method || 'GET' };
    calls.push(call);

    if (call.url.includes('oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({
        access_token: 'access-token',
        token_type: 'Bearer',
        expires_in: 3600,
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      range: "'JRA_指数マスター'!A1:C3",
      values: [
        ['開催日', '馬番', '馬名'],
        ['2026-09-13', 1, 'テストホース'],
        ['2026-09-13', 2, 'テストホース2'],
      ],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const result = await readChassArchiveSheet(
    COMPLETE_ENV,
    'JRA_指数マスター',
    { organization: 'JRA', fetcher },
  );

  assert.equal(result.mode, 'read_only');
  assert.equal(result.organization, 'JRA');
  assert.equal(result.rowCount, 2);
  assert.equal(result.records[0].馬名, 'テストホース');

  const sheetsCalls = calls.filter((c) => c.url.includes('sheets.googleapis.com'));
  assert.equal(sheetsCalls.length, 1);
  assert.equal(sheetsCalls[0].method, 'GET');

  const joined = calls.map((c) => `${c.method} ${c.url}`).join('\n');
  assert.equal(/values:append|:batchUpdate|\/values\/[^?]+:(?:append|update)/i.test(joined), false);
});
