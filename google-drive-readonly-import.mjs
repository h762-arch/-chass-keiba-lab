/**
 * CHASS Google Drive Read-Only Import
 * Safe, server-side-only Google Sheets reader.
 *
 * Design constraints:
 * - Read-only Google Sheets scope only.
 * - No Drive/Sheets write operations.
 * - No browser-direct Google API access.
 * - No D1 writes or prediction snapshot mutation.
 * - JRA/NAR sheet allowlists are physically separated.
 * - Legacy sheets are denied.
 * - Feature flag defaults OFF.
 */

const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const READ_ONLY_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const DEFAULT_TIMEOUT_MS = 12_000;

export const CHASS_DRIVE_READONLY_SCHEMA_VERSION = '1.1';

export const CHASS_DRIVE_SHEET_ALLOWLIST = Object.freeze({
  JRA: Object.freeze([
    'JRA_予想アーカイブ',
    'JRA_レース結果',
    'JRA_レース後検証',
    'JRA_指数マスター',
    'JRA_改善履歴',
    'JRA_指数隣接研究',
    'JRA_指数クラスター事前検証',
  ]),
  NAR: Object.freeze([
    'NAR_予想アーカイブ',
    'NAR_レース結果',
    'NAR_レース後検証',
    'NAR_指数マスター',
    'NAR_改善履歴',
    'NAR_指数隣接研究',
  ]),
});

export const CHASS_DRIVE_LEGACY_DENYLIST = Object.freeze([
  '予想アーカイブ',
  'レース結果',
  'レース後検証',
  'CHASS指数マスター',
  'モデル改善履歴',
]);

function bool(value) {
  return /^(1|true|on|yes)$/i.test(String(value ?? '').trim());
}

function nonEmpty(value) {
  const s = String(value ?? '').trim();
  return s || null;
}

function safeErrorMessage(error) {
  return String(error?.message || error || 'unknown_error').slice(0, 240);
}

function makeError(code, message, details = {}) {
  const error = new Error(message || code);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function assertServerSide() {
  // Cloudflare Worker / Node: window is undefined.
  // Browsers must never receive OAuth client secret / refresh token logic.
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    throw makeError(
      'DRIVE_READ_BROWSER_FORBIDDEN',
      'Google Drive read import is server-side only.',
    );
  }
}

export function driveReadImportEnabled(env = {}) {
  return bool(env.ENABLE_DRIVE_READ_IMPORT);
}

export function getDriveReadConfig(env = {}) {
  return {
    enabled: driveReadImportEnabled(env),
    spreadsheetId: nonEmpty(env.CHASS_DRIVE_SPREADSHEET_ID),
    clientId: nonEmpty(env.GOOGLE_DRIVE_READ_CLIENT_ID),
    clientSecret: nonEmpty(env.GOOGLE_DRIVE_READ_CLIENT_SECRET),
    refreshToken: nonEmpty(env.GOOGLE_DRIVE_READ_REFRESH_TOKEN),
    scope: READ_ONLY_SCOPE,
  };
}

export function getDriveReadReadiness(env = {}) {
  const cfg = getDriveReadConfig(env);
  const missing = [];
  if (!cfg.spreadsheetId) missing.push('CHASS_DRIVE_SPREADSHEET_ID');
  if (!cfg.clientId) missing.push('GOOGLE_DRIVE_READ_CLIENT_ID');
  if (!cfg.clientSecret) missing.push('GOOGLE_DRIVE_READ_CLIENT_SECRET');
  if (!cfg.refreshToken) missing.push('GOOGLE_DRIVE_READ_REFRESH_TOKEN');

  return {
    schemaVersion: CHASS_DRIVE_READONLY_SCHEMA_VERSION,
    enabled: cfg.enabled,
    configured: missing.length === 0,
    missing,
    mode: 'read_only',
    scope: cfg.scope,
    browserDirectGoogleAccess: false,
    d1WriteEnabled: false,
    predictionSnapshotMutationEnabled: false,
  };
}

function requireDriveReadConfig(env = {}) {
  assertServerSide();
  const readiness = getDriveReadReadiness(env);

  if (!readiness.enabled) {
    throw makeError('DRIVE_READ_DISABLED', 'ENABLE_DRIVE_READ_IMPORT is not enabled.');
  }
  if (!readiness.configured) {
    throw makeError(
      'DRIVE_READ_CONFIG_INCOMPLETE',
      `Missing Drive read configuration: ${readiness.missing.join(', ')}`,
      { missing: readiness.missing },
    );
  }

  return getDriveReadConfig(env);
}

function withTimeout(timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), Math.max(1, timeoutMs));
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

async function parseJsonResponse(response, codePrefix) {
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw makeError(`${codePrefix}_RESPONSE_INVALID`, 'Google API returned non-JSON data.', {
        status: response.status,
      });
    }
  }
  return data;
}

function classifyGoogleStatus(status, prefix = 'DRIVE_READ') {
  if (status === 401) return `${prefix}_AUTH_FAILED`;
  if (status === 403) return `${prefix}_PERMISSION_DENIED`;
  if (status === 404) return `${prefix}_NOT_FOUND`;
  if (status === 429) return `${prefix}_RATE_LIMITED`;
  if (status >= 500) return `${prefix}_UPSTREAM_ERROR`;
  return `${prefix}_HTTP_${status}`;
}

export async function refreshGoogleReadAccessToken(env = {}, options = {}) {
  const cfg = requireDriveReadConfig(env);
  const fetcher = options.fetcher || fetch;
  const timeout = withTimeout(options.timeoutMs);

  try {
    const body = new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: cfg.refreshToken,
      grant_type: 'refresh_token',
    });

    const response = await fetcher(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: timeout.signal,
    });

    const data = await parseJsonResponse(response, 'DRIVE_READ_TOKEN');
    if (!response.ok) {
      throw makeError(
        classifyGoogleStatus(response.status, 'DRIVE_READ_TOKEN'),
        `Google OAuth token refresh failed with HTTP ${response.status}.`,
        { status: response.status },
      );
    }

    const accessToken = nonEmpty(data?.access_token);
    if (!accessToken) {
      throw makeError('DRIVE_READ_TOKEN_RESPONSE_INVALID', 'Google OAuth response had no access token.');
    }

    return {
      accessToken,
      tokenType: nonEmpty(data?.token_type) || 'Bearer',
      expiresIn: Number(data?.expires_in) || null,
      scope: nonEmpty(data?.scope) || null,
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw makeError('DRIVE_READ_TOKEN_TIMEOUT', 'Google OAuth token refresh timed out.');
    }
    if (error?.code) throw error;
    throw makeError('DRIVE_READ_TOKEN_NETWORK_ERROR', safeErrorMessage(error));
  } finally {
    timeout.clear();
  }
}

async function googleSheetsGet(url, accessToken, options = {}) {
  const fetcher = options.fetcher || fetch;
  const timeout = withTimeout(options.timeoutMs);

  try {
    const response = await fetcher(url, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: 'application/json',
      },
      signal: timeout.signal,
    });

    const data = await parseJsonResponse(response, 'DRIVE_READ_SHEETS');
    if (!response.ok) {
      throw makeError(
        classifyGoogleStatus(response.status, 'DRIVE_READ_SHEETS'),
        `Google Sheets API failed with HTTP ${response.status}.`,
        { status: response.status },
      );
    }
    return data;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw makeError('DRIVE_READ_SHEETS_TIMEOUT', 'Google Sheets API request timed out.');
    }
    if (error?.code) throw error;
    throw makeError('DRIVE_READ_SHEETS_NETWORK_ERROR', safeErrorMessage(error));
  } finally {
    timeout.clear();
  }
}

function normalizeOrganization(value) {
  const org = String(value ?? '').trim().toUpperCase();
  if (org !== 'JRA' && org !== 'NAR') {
    throw makeError('DRIVE_READ_ORGANIZATION_REQUIRED', 'organization must be explicitly JRA or NAR.');
  }
  return org;
}

function allAllowedTitles() {
  return new Set([
    ...CHASS_DRIVE_SHEET_ALLOWLIST.JRA,
    ...CHASS_DRIVE_SHEET_ALLOWLIST.NAR,
  ]);
}

export function assertAllowedSheet(sheetTitle, organization = null) {
  const title = String(sheetTitle ?? '').trim();
  if (!title) throw makeError('DRIVE_READ_SHEET_REQUIRED', 'sheet title is required.');
  if (CHASS_DRIVE_LEGACY_DENYLIST.includes(title)) {
    throw makeError('DRIVE_READ_LEGACY_SHEET_DENIED', `Legacy sheet is denied: ${title}`);
  }

  if (organization) {
    const org = normalizeOrganization(organization);
    if (!CHASS_DRIVE_SHEET_ALLOWLIST[org].includes(title)) {
      throw makeError('DRIVE_READ_SHEET_NOT_ALLOWLISTED', `Sheet is not allowlisted for ${org}: ${title}`);
    }
    return { organization: org, sheetTitle: title };
  }

  if (!allAllowedTitles().has(title)) {
    throw makeError('DRIVE_READ_SHEET_NOT_ALLOWLISTED', `Sheet is not allowlisted: ${title}`);
  }
  const org = title.startsWith('JRA_') ? 'JRA' : title.startsWith('NAR_') ? 'NAR' : null;
  if (!org) {
    throw makeError('DRIVE_READ_ORGANIZATION_REQUIRED', `Cannot infer explicit organization from sheet title: ${title}`);
  }
  return { organization: org, sheetTitle: title };
}

function escapeA1SheetTitle(title) {
  return `'${String(title).replaceAll("'", "''")}'`;
}

function normalizeHeaders(row = []) {
  const seen = new Map();
  return row.map((value, index) => {
    const base = nonEmpty(value) || `column_${index + 1}`;
    const count = (seen.get(base) || 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base}__${count}`;
  });
}

function rowHasValue(row = []) {
  return row.some((value) => String(value ?? '').trim() !== '');
}

export function valuesToRecords(values = []) {
  const rows = Array.isArray(values) ? values : [];
  if (!rows.length) return { headers: [], rows: [], records: [] };

  const headers = normalizeHeaders(Array.isArray(rows[0]) ? rows[0] : []);
  const dataRows = rows.slice(1).filter((row) => Array.isArray(row) && rowHasValue(row));
  const records = dataRows.map((row) => {
    const record = {};
    for (let i = 0; i < headers.length; i += 1) {
      record[headers[i]] = row[i] ?? '';
    }
    return record;
  });

  return { headers, rows: dataRows, records };
}

export async function readChassSpreadsheetCatalog(env = {}, options = {}) {
  const cfg = requireDriveReadConfig(env);
  const token = options.accessToken
    ? { accessToken: options.accessToken }
    : await refreshGoogleReadAccessToken(env, options);

  const fields = encodeURIComponent(
    'properties(title,locale,timeZone),sheets(properties(sheetId,title,index,hidden))',
  );
  const url = `${GOOGLE_SHEETS_BASE}/${encodeURIComponent(cfg.spreadsheetId)}?includeGridData=false&fields=${fields}`;
  const data = await googleSheetsGet(url, token.accessToken, options);

  const sheets = (data?.sheets || []).map((sheet) => ({
    sheetId: sheet?.properties?.sheetId ?? null,
    title: String(sheet?.properties?.title || ''),
    index: Number(sheet?.properties?.index) || 0,
    hidden: Boolean(sheet?.properties?.hidden),
  }));

  return {
    spreadsheetId: cfg.spreadsheetId,
    title: nonEmpty(data?.properties?.title),
    locale: nonEmpty(data?.properties?.locale),
    timeZone: nonEmpty(data?.properties?.timeZone),
    sheets,
    accessToken: token.accessToken,
  };
}

export async function readChassArchiveSheet(env = {}, sheetTitle, options = {}) {
  const cfg = requireDriveReadConfig(env);
  const checked = assertAllowedSheet(sheetTitle, options.organization || null);
  const token = options.accessToken
    ? { accessToken: options.accessToken }
    : await refreshGoogleReadAccessToken(env, options);

  const maxColumn = nonEmpty(options.maxColumn) || 'ZZ';
  if (!/^[A-Z]{1,3}$/.test(maxColumn)) {
    throw makeError('DRIVE_READ_RANGE_INVALID', 'maxColumn must be A-ZZZ.');
  }

  const a1 = `${escapeA1SheetTitle(checked.sheetTitle)}!A:${maxColumn}`;
  const params = new URLSearchParams({
    majorDimension: 'ROWS',
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
  });
  const url = `${GOOGLE_SHEETS_BASE}/${encodeURIComponent(cfg.spreadsheetId)}/values/${encodeURIComponent(a1)}?${params}`;
  const data = await googleSheetsGet(url, token.accessToken, options);
  const converted = valuesToRecords(data?.values || []);

  return {
    schemaVersion: CHASS_DRIVE_READONLY_SCHEMA_VERSION,
    source: 'google_sheets',
    mode: 'read_only',
    organization: checked.organization,
    spreadsheetId: cfg.spreadsheetId,
    sheetTitle: checked.sheetTitle,
    range: nonEmpty(data?.range) || a1,
    rowCount: converted.records.length,
    headers: converted.headers,
    records: converted.records,
    ...(options.includeRows ? { rows: converted.rows } : {}),
  };
}

export async function readChassArchiveOrganization(env = {}, organization, options = {}) {
  const org = normalizeOrganization(organization);
  const catalog = await readChassSpreadsheetCatalog(env, options);
  const existing = new Set(catalog.sheets.filter((s) => !s.hidden).map((s) => s.title));
  const requested = Array.isArray(options.sheetNames) && options.sheetNames.length
    ? options.sheetNames.map((name) => assertAllowedSheet(name, org).sheetTitle)
    : [...CHASS_DRIVE_SHEET_ALLOWLIST[org]];

  const available = requested.filter((name) => existing.has(name));
  const missing = requested.filter((name) => !existing.has(name));
  const sheets = {};

  // Sequential reads reduce burst pressure and make rate-limit behavior predictable.
  for (const name of available) {
    sheets[name] = await readChassArchiveSheet(env, name, {
      ...options,
      organization: org,
      accessToken: catalog.accessToken,
    });
  }

  return {
    schemaVersion: CHASS_DRIVE_READONLY_SCHEMA_VERSION,
    source: 'google_sheets',
    mode: 'read_only',
    organization: org,
    spreadsheet: {
      id: catalog.spreadsheetId,
      title: catalog.title,
      locale: catalog.locale,
      timeZone: catalog.timeZone,
    },
    availableSheets: available,
    missingSheets: missing,
    sheets,
  };
}

export async function readChassArchive(env = {}, options = {}) {
  // Explicit-only organization rule: no implicit cross-org merge.
  const org = normalizeOrganization(options.organization);
  return readChassArchiveOrganization(env, org, options);
}

export function sanitizeDriveReadError(error) {
  return {
    code: nonEmpty(error?.code) || 'DRIVE_READ_UNKNOWN_ERROR',
    message: safeErrorMessage(error),
    status: Number(error?.status) || null,
  };
}
