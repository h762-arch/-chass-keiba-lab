import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

import {
  CHASS_DRIVE_SHEET_ALLOWLIST,
  assertAllowedSheet,
  driveReadImportEnabled,
  getDriveReadReadiness,
  getGoogleServiceAccountAccessToken,
  readChassArchiveSheet,
  valuesToRecords,
} from '../google-drive-readonly-import.mjs';

function arrayBufferToBase64(buffer) {
  return Buffer.from(new Uint8Array(buffer)).toString('base64');
}

async function makeServiceAccountJson() {
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );

  const pkcs8 = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
  const b64 = arrayBufferToBase64(pkcs8).match(/.{1,64}/g).join('\n');

  return JSON.stringify({
    type: 'service_account',
    project_id: 'chass-test',
    private_key_id: 'test-key',
    private_key: `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`,
    client_email: 'chass-drive-reader@chass-test.iam.gserviceaccount.com',
    client_id: '1234567890',
    token_uri: 'https://oauth2.googleapis.com/token',
  });
}

async function completeEnv() {
  return {
    ENABLE_DRIVE_READ_IMPORT: 'true',
    CHASS_DRIVE_SPREADSHEET_ID: 'sheet-123',
    GOOGLE_DRIVE_READ_SERVICE_ACCOUNT_JSON: await makeServiceAccountJson(),
  };
}

test('Drive read import defaults disabled', () => {
  assert.equal(driveReadImportEnabled({}), false);
  assert.equal(driveReadImportEnabled({ ENABLE_DRIVE_READ_IMPORT: 'false' }), false);
  assert.equal(driveReadImportEnabled({ ENABLE_DRIVE_READ_IMPORT: 'true' }), true);
});

test('readiness requires service-account JSON and does not expose secret contents', async () => {
  const readiness = getDriveReadReadiness({
    ENABLE_DRIVE_READ_IMPORT: 'true',
    CHASS_DRIVE_SPREADSHEET_ID: 'sheet-123',
  });

  assert.equal(readiness.authMode, 'service_account');
  assert.equal(readiness.configured, false);
  assert.deepEqual(readiness.missing, ['GOOGLE_DRIVE_READ_SERVICE_ACCOUNT_JSON']);

  const env = await completeEnv();
  const configured = getDriveReadReadiness(env);
  assert.equal(configured.configured, true);
  assert.equal(configured.credentialValid, true);
  assert.equal(JSON.stringify(configured).includes('PRIVATE KEY'), false);
  assert.equal(JSON.stringify(configured).includes('chass-drive-reader@'), false);
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

test('valuesToRecords keeps deterministic de-duplicated headers', () => {
  const converted = valuesToRecords([
    ['馬番', '馬名', '馬名'],
    [1, 'テストA', '別名A'],
    [2, 'テストB'],
    ['', '', ''],
  ]);

  assert.deepEqual(converted.headers, ['馬番', '馬名', '馬名__2']);
  assert.equal(converted.records.length, 2);
  assert.deepEqual(converted.records[1], {
    馬番: 2,
    馬名: 'テストB',
    馬名__2: '',
  });
});

test('service-account token exchange uses JWT bearer POST without client secret or refresh token', async () => {
  const env = await completeEnv();
  const calls = [];

  const fetcher = async (url, init = {}) => {
    const body = init.body instanceof URLSearchParams ? init.body : new URLSearchParams(init.body);
    calls.push({
      url: String(url),
      method: init.method || 'GET',
      grantType: body.get('grant_type'),
      assertion: body.get('assertion'),
    });

    return new Response(JSON.stringify({
      access_token: 'access-token',
      token_type: 'Bearer',
      expires_in: 3600,
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const token = await getGoogleServiceAccountAccessToken(env, {
    fetcher,
    nowMs: 1_700_000_000_000,
  });

  assert.equal(token.accessToken, 'access-token');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.equal(
    calls[0].grantType,
    'urn:ietf:params:oauth:grant-type:jwt-bearer',
  );
  assert.equal(calls[0].assertion.split('.').length, 3);
  assert.equal(JSON.stringify(calls).includes('refresh_token'), false);
  assert.equal(JSON.stringify(calls).includes('client_secret'), false);
});

test('sheet data path uses Google Sheets GET only and supports bounded live-test range', async () => {
  const env = await completeEnv();
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
      range: "'JRA_指数マスター'!A1:A2",
      values: [
        ['開催日'],
        ['2026-09-13'],
      ],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const result = await readChassArchiveSheet(
    env,
    'JRA_指数マスター',
    {
      organization: 'JRA',
      maxColumn: 'A',
      maxRows: 2,
      fetcher,
    },
  );

  assert.equal(result.authMode, 'service_account');
  assert.equal(result.mode, 'read_only');
  assert.equal(result.organization, 'JRA');
  assert.equal(result.rowCount, 1);

  const sheetsCalls = calls.filter((c) => c.url.includes('sheets.googleapis.com'));
  assert.equal(sheetsCalls.length, 1);
  assert.equal(sheetsCalls[0].method, 'GET');
  assert.match(decodeURIComponent(sheetsCalls[0].url), /JRA_指数マスター.*A1:A2/);

  const joined = calls.map((c) => `${c.method} ${c.url}`).join('\n');
  assert.equal(/values:append|:batchUpdate|\/values\/[^?]+:(?:append|update)/i.test(joined), false);
});
