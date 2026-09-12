/**
 * CHASS Google Drive Read-Only runtime API.
 *
 * Public route:
 *   GET /api/drive-read/health
 *     - returns only safe connectivity metadata
 *     - never returns spreadsheet rows or credentials
 *
 * Protected CHASS Bridge route:
 *   GET /api/chass/v1/drive?organization=JRA&sheet=JRA_指数マスター&maxRows=500
 *     - authentication/rate limit is enforced by worker.js handleChassBridge
 *     - underlying Reader enforces JRA/NAR allowlists and read-only access
 */

import {
  getDriveReadReadiness,
  readChassArchiveSheet,
  readChassSpreadsheetCatalog,
  sanitizeDriveReadError,
} from './google-drive-readonly-import.mjs';

function responseJson(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...headers,
    },
  });
}

function safeReadiness(env = {}) {
  const r = getDriveReadReadiness(env);
  return {
    schemaVersion: r.schemaVersion,
    authMode: r.authMode,
    enabled: r.enabled,
    configured: r.configured,
    credentialValid: r.credentialValid,
    missing: Array.isArray(r.missing) ? r.missing : [],
    mode: r.mode,
    scope: r.scope,
    d1WriteEnabled: false,
    predictionSnapshotMutationEnabled: false,
  };
}

export async function handleDriveReadHealth(request, env = {}) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return responseJson(
      { ok: false, error: 'method_not_allowed' },
      405,
      { allow: 'GET, HEAD' },
    );
  }

  const head = request.method === 'HEAD';
  const readiness = safeReadiness(env);

  if (!readiness.enabled || !readiness.configured) {
    const payload = {
      ok: false,
      service: 'chass-google-drive-readonly',
      ...readiness,
      spreadsheetReachable: false,
      checkedAt: new Date().toISOString(),
    };
    return head
      ? new Response(null, {
          status: 503,
          headers: {
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
          },
        })
      : responseJson(payload, 503);
  }

  try {
    const catalog = await readChassSpreadsheetCatalog(env);
    const sample = await readChassArchiveSheet(
      env,
      'JRA_指数マスター',
      {
        organization: 'JRA',
        maxColumn: 'A',
        maxRows: 2,
        accessToken: catalog.accessToken,
      },
    );

    const payload = {
      ok: true,
      service: 'chass-google-drive-readonly',
      ...readiness,
      spreadsheetReachable: true,
      spreadsheetTitleMatched:
        catalog.title === 'CHASS競馬研究所_アーカイブマスター',
      visibleSheetCount: catalog.sheets.length,
      jraIndexMasterReachable: true,
      sampleParsedRows: sample.rowCount,
      checkedAt: new Date().toISOString(),
    };

    if (head) {
      return new Response(null, {
        status: 200,
        headers: {
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        },
      });
    }
    return responseJson(payload);
  } catch (error) {
    const safe = sanitizeDriveReadError(error);
    const payload = {
      ok: false,
      service: 'chass-google-drive-readonly',
      ...readiness,
      spreadsheetReachable: false,
      error: {
        code: safe.code,
        status: safe.status,
      },
      checkedAt: new Date().toISOString(),
    };
    return head
      ? new Response(null, {
          status: 503,
          headers: {
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
          },
        })
      : responseJson(payload, 503);
  }
}

export async function handleDriveReadBridge(request, env = {}, cors = {}) {
  if (request.method !== 'GET') {
    return responseJson(
      { ok: false, error: 'method_not_allowed' },
      405,
      { ...cors, allow: 'GET' },
    );
  }

  const readiness = safeReadiness(env);
  if (!readiness.enabled || !readiness.configured) {
    return responseJson(
      {
        ok: false,
        error: 'drive_read_not_configured',
        readiness,
      },
      503,
      cors,
    );
  }

  const url = new URL(request.url);
  const organization = String(url.searchParams.get('organization') || '')
    .trim()
    .toUpperCase();
  const sheet = String(url.searchParams.get('sheet') || '').trim();

  if (organization !== 'JRA' && organization !== 'NAR') {
    return responseJson(
      {
        ok: false,
        error: 'organization_required',
        message: 'organization must be JRA or NAR',
      },
      400,
      cors,
    );
  }

  if (!sheet) {
    return responseJson(
      {
        ok: false,
        error: 'sheet_required',
      },
      400,
      cors,
    );
  }

  const requestedMaxRows = Number(url.searchParams.get('maxRows'));
  const maxRows = Number.isInteger(requestedMaxRows) && requestedMaxRows > 0
    ? Math.min(requestedMaxRows, 1000)
    : 250;

  const requestedMaxColumn = String(
    url.searchParams.get('maxColumn') || 'ZZ',
  ).trim().toUpperCase();
  const maxColumn = /^[A-Z]{1,3}$/.test(requestedMaxColumn)
    ? requestedMaxColumn
    : 'ZZ';

  try {
    const result = await readChassArchiveSheet(
      env,
      sheet,
      {
        organization,
        maxRows,
        maxColumn,
      },
    );

    return responseJson(
      {
        ok: true,
        apiVersion: 'drive-read-v1',
        source: 'private_google_sheets',
        mode: 'read_only',
        organization: result.organization,
        sheetTitle: result.sheetTitle,
        range: result.range,
        rowCount: result.rowCount,
        headers: result.headers,
        records: result.records,
        generatedAt: new Date().toISOString(),
      },
      200,
      cors,
    );
  } catch (error) {
    const safe = sanitizeDriveReadError(error);
    const status =
      safe.code === 'DRIVE_READ_SHEET_NOT_ALLOWLISTED' ||
      safe.code === 'DRIVE_READ_LEGACY_SHEET_DENIED' ||
      safe.code === 'DRIVE_READ_ORGANIZATION_REQUIRED'
        ? 400
        : 503;

    return responseJson(
      {
        ok: false,
        error: safe.code,
        status: safe.status,
      },
      status,
      cors,
    );
  }
}
