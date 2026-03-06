import { nanoid } from 'nanoid';
import { dbAll, dbGet, dbRun, getAffectedRows, now, type Db } from '$lib/server/db';
import { createOpaqueToken, sha256Base64Url } from './crypto';
import { OAUTH_SCOPE_READ } from './audience';

export { OAUTH_SCOPE_READ } from './audience';

export const OAUTH_CODE_TTL_MS = 5 * 60 * 1000;
export const OAUTH_ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
export const OAUTH_REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type OAuthClient = {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  grantTypes: string[];
  responseTypes: string[];
  tokenEndpointAuthMethod: string;
  scope: string | null;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number | null;
};

export type OAuthClientSummary = OAuthClient & {
  clientKind: 'mcp' | 'mobile' | 'unknown';
  activeAccessTokens: number;
  activeRefreshTokens: number;
  activeConsentCount: number;
};

type OAuthClientRow = {
  client_id: string;
  client_name: string;
  redirect_uris_json: string;
  grant_types_json: string;
  response_types_json: string;
  token_endpoint_auth_method: string;
  scope: string | null;
  created_at: number;
  updated_at: number;
  last_used_at: number | null;
};

type OAuthAuthorizationCodeRow = {
  id: string;
  code_hash: string;
  client_id: string;
  user_id: string;
  redirect_uri: string;
  scope: string;
  resource: string;
  code_challenge: string;
  code_challenge_method: string;
  expires_at: number;
  used_at: number | null;
  created_at: number;
};

type OAuthTokenRow = {
  id: string;
  client_id: string;
  user_id: string;
  scope: string;
  resource: string;
  expires_at: number;
  revoked_at: number | null;
  created_at: number;
  last_used_at: number | null;
};

type OAuthClientSummaryRow = OAuthClientRow & {
  active_access_tokens: number;
  active_refresh_tokens: number;
  active_consent_count: number;
};

const parseJsonArray = (raw: string) => {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((entry) => String(entry)) : [];
  } catch {
    return [];
  }
};

const mapClient = (row: OAuthClientRow): OAuthClient => ({
  clientId: row.client_id,
  clientName: row.client_name,
  redirectUris: parseJsonArray(row.redirect_uris_json),
  grantTypes: parseJsonArray(row.grant_types_json),
  responseTypes: parseJsonArray(row.response_types_json),
  tokenEndpointAuthMethod: row.token_endpoint_auth_method,
  scope: row.scope,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  lastUsedAt: row.last_used_at
});

const inferClientKind = (scope: string | null) => {
  if (!scope) return 'unknown' as const;
  if (scope.includes('mcp:')) return 'mcp' as const;
  if (scope.includes('app:')) return 'mobile' as const;
  return 'unknown' as const;
};

export const registerOAuthClient = async (
  db: Db,
  input: {
    clientName: string;
    redirectUris: string[];
    grantTypes?: string[];
    responseTypes?: string[];
    tokenEndpointAuthMethod?: string;
    scope?: string | null;
  }
) => {
  const timestamp = now();
  const clientId = `mcp_${createOpaqueToken(18)}`;
  await dbRun(
    db,
    `INSERT INTO oauth_clients (
      client_id,
      client_name,
      redirect_uris_json,
      grant_types_json,
      response_types_json,
      token_endpoint_auth_method,
      scope,
      created_at,
      updated_at,
      last_used_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    [
      clientId,
      input.clientName,
      JSON.stringify(input.redirectUris),
      JSON.stringify(input.grantTypes ?? ['authorization_code', 'refresh_token']),
      JSON.stringify(input.responseTypes ?? ['code']),
      input.tokenEndpointAuthMethod ?? 'none',
      input.scope ?? OAUTH_SCOPE_READ,
      timestamp,
      timestamp
    ]
  );

  const client = await getOAuthClient(db, clientId);
  if (!client) {
    throw new Error('Failed to load registered OAuth client');
  }
  return client;
};

export const upsertOAuthClient = async (
  db: Db,
  input: {
    clientId: string;
    clientName: string;
    redirectUris: string[];
    grantTypes?: string[];
    responseTypes?: string[];
    tokenEndpointAuthMethod?: string;
    scope?: string | null;
  }
) => {
  const timestamp = now();
  await dbRun(
    db,
    `INSERT INTO oauth_clients (
      client_id,
      client_name,
      redirect_uris_json,
      grant_types_json,
      response_types_json,
      token_endpoint_auth_method,
      scope,
      created_at,
      updated_at,
      last_used_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(client_id) DO UPDATE SET
      client_name = excluded.client_name,
      redirect_uris_json = excluded.redirect_uris_json,
      grant_types_json = excluded.grant_types_json,
      response_types_json = excluded.response_types_json,
      token_endpoint_auth_method = excluded.token_endpoint_auth_method,
      scope = excluded.scope,
      updated_at = excluded.updated_at`,
    [
      input.clientId,
      input.clientName,
      JSON.stringify(input.redirectUris),
      JSON.stringify(input.grantTypes ?? ['authorization_code', 'refresh_token']),
      JSON.stringify(input.responseTypes ?? ['code']),
      input.tokenEndpointAuthMethod ?? 'none',
      input.scope ?? OAUTH_SCOPE_READ,
      timestamp,
      timestamp
    ]
  );

  const client = await getOAuthClient(db, input.clientId);
  if (!client) {
    throw new Error('Failed to load OAuth client');
  }
  return client;
};

export const getOAuthClient = async (db: Db, clientId: string) => {
  const row = await dbGet<OAuthClientRow>(
    db,
    `SELECT client_id, client_name, redirect_uris_json, grant_types_json, response_types_json,
            token_endpoint_auth_method, scope, created_at, updated_at, last_used_at
     FROM oauth_clients
     WHERE client_id = ?`,
    [clientId]
  );
  return row ? mapClient(row) : null;
};

export const listOAuthClientSummaries = async (db: Db): Promise<OAuthClientSummary[]> => {
  const rows = await dbAll<OAuthClientSummaryRow>(
    db,
    `SELECT c.client_id, c.client_name, c.redirect_uris_json, c.grant_types_json, c.response_types_json,
            c.token_endpoint_auth_method, c.scope, c.created_at, c.updated_at, c.last_used_at,
            (
              SELECT COUNT(*)
              FROM oauth_access_tokens at
              WHERE at.client_id = c.client_id
                AND at.revoked_at IS NULL
                AND at.expires_at > ?
            ) AS active_access_tokens,
            (
              SELECT COUNT(*)
              FROM oauth_refresh_tokens rt
              WHERE rt.client_id = c.client_id
                AND rt.revoked_at IS NULL
                AND rt.expires_at > ?
            ) AS active_refresh_tokens,
            (
              SELECT COUNT(*)
              FROM oauth_consents oc
              WHERE oc.client_id = c.client_id
                AND oc.revoked_at IS NULL
            ) AS active_consent_count
     FROM oauth_clients c
     ORDER BY COALESCE(c.last_used_at, c.updated_at) DESC, c.client_name COLLATE NOCASE ASC`,
    [now(), now()]
  );

  return rows.map((row) => ({
    ...mapClient(row),
    clientKind: inferClientKind(row.scope),
    activeAccessTokens: Number(row.active_access_tokens ?? 0),
    activeRefreshTokens: Number(row.active_refresh_tokens ?? 0),
    activeConsentCount: Number(row.active_consent_count ?? 0)
  }));
};

export const hasActiveConsent = async (db: Db, clientId: string, userId: string, scope: string) => {
  const row = await dbGet<{ id: string }>(
    db,
    `SELECT id
     FROM oauth_consents
     WHERE client_id = ?
       AND user_id = ?
       AND scope = ?
       AND revoked_at IS NULL
     LIMIT 1`,
    [clientId, userId, scope]
  );
  return Boolean(row?.id);
};

export const grantConsent = async (db: Db, clientId: string, userId: string, scope: string) => {
  const timestamp = now();
  await dbRun(
    db,
    `INSERT INTO oauth_consents (id, client_id, user_id, scope, granted_at, revoked_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
     ON CONFLICT(client_id, user_id, scope) DO UPDATE SET
       granted_at = excluded.granted_at,
       revoked_at = NULL,
       updated_at = excluded.updated_at`,
    [nanoid(), clientId, userId, scope, timestamp, timestamp, timestamp]
  );
};

export const createAuthorizationCode = async (
  db: Db,
  input: {
    clientId: string;
    userId: string;
    redirectUri: string;
    scope: string;
    resource: string;
    codeChallenge: string;
    codeChallengeMethod: string;
  }
) => {
  const rawCode = createOpaqueToken(32);
  const codeHash = await sha256Base64Url(rawCode);
  const timestamp = now();
  await dbRun(
    db,
    `INSERT INTO oauth_authorization_codes (
      id, code_hash, client_id, user_id, redirect_uri, scope, resource,
      code_challenge, code_challenge_method, expires_at, used_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    [
      nanoid(),
      codeHash,
      input.clientId,
      input.userId,
      input.redirectUri,
      input.scope,
      input.resource,
      input.codeChallenge,
      input.codeChallengeMethod,
      timestamp + OAUTH_CODE_TTL_MS,
      timestamp
    ]
  );
  return rawCode;
};

export const getAuthorizationCodeByRawCode = async (db: Db, rawCode: string) => {
  const codeHash = await sha256Base64Url(rawCode);
  const row = await dbGet<OAuthAuthorizationCodeRow>(
    db,
    `SELECT id, code_hash, client_id, user_id, redirect_uri, scope, resource,
            code_challenge, code_challenge_method, expires_at, used_at, created_at
     FROM oauth_authorization_codes
     WHERE code_hash = ?`,
    [codeHash]
  );
  return row ?? null;
};

export const markAuthorizationCodeUsed = async (db: Db, id: string) => {
  const result = await dbRun(
    db,
    'UPDATE oauth_authorization_codes SET used_at = ? WHERE id = ? AND used_at IS NULL',
    [now(), id]
  );
  return getAffectedRows(result) > 0;
};

const createTokenPair = async (
  db: Db,
  input: {
    clientId: string;
    userId: string;
    scope: string;
    resource: string;
    refreshTokenFromId?: string | null;
  }
) => {
  const timestamp = now();
  const accessToken = createOpaqueToken(32);
  const refreshToken = createOpaqueToken(32);
  const accessHash = await sha256Base64Url(accessToken);
  const refreshHash = await sha256Base64Url(refreshToken);
  const accessId = nanoid();
  const refreshId = nanoid();

  await dbRun(
    db,
    `INSERT INTO oauth_access_tokens (
      id, token_hash, client_id, user_id, scope, resource, expires_at, revoked_at, created_at, last_used_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL)`,
    [
      accessId,
      accessHash,
      input.clientId,
      input.userId,
      input.scope,
      input.resource,
      timestamp + OAUTH_ACCESS_TOKEN_TTL_MS,
      timestamp
    ]
  );

  await dbRun(
    db,
    `INSERT INTO oauth_refresh_tokens (
      id, token_hash, client_id, user_id, scope, resource, expires_at, revoked_at, rotated_from_id, created_at, last_used_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)`,
    [
      refreshId,
      refreshHash,
      input.clientId,
      input.userId,
      input.scope,
      input.resource,
      timestamp + OAUTH_REFRESH_TOKEN_TTL_MS,
      input.refreshTokenFromId ?? null,
      timestamp
    ]
  );

  return {
    accessToken,
    refreshToken,
    accessTokenExpiresAt: timestamp + OAUTH_ACCESS_TOKEN_TTL_MS,
    refreshTokenExpiresAt: timestamp + OAUTH_REFRESH_TOKEN_TTL_MS
  };
};

export const issueTokenPair = createTokenPair;

export const getAccessTokenByRawToken = async (db: Db, rawToken: string) => {
  const tokenHash = await sha256Base64Url(rawToken);
  const row = await dbGet<OAuthTokenRow>(
    db,
    `SELECT id, client_id, user_id, scope, resource, expires_at, revoked_at, created_at, last_used_at
     FROM oauth_access_tokens
     WHERE token_hash = ?`,
    [tokenHash]
  );
  return row ?? null;
};

export const getRefreshTokenByRawToken = async (db: Db, rawToken: string) => {
  const tokenHash = await sha256Base64Url(rawToken);
  const row = await dbGet<OAuthTokenRow & { token_hash: string }>(
    db,
    `SELECT id, token_hash, client_id, user_id, scope, resource, expires_at, revoked_at, created_at, last_used_at
     FROM oauth_refresh_tokens
     WHERE token_hash = ?`,
    [tokenHash]
  );
  return row ?? null;
};

export const touchAccessToken = async (db: Db, id: string, clientId: string) => {
  const timestamp = now();
  await dbRun(db, 'UPDATE oauth_access_tokens SET last_used_at = ? WHERE id = ?', [timestamp, id]);
  await dbRun(db, 'UPDATE oauth_clients SET last_used_at = ?, updated_at = updated_at WHERE client_id = ?', [timestamp, clientId]);
};

export const revokeRefreshToken = async (db: Db, id: string) => {
  const result = await dbRun(
    db,
    'UPDATE oauth_refresh_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL',
    [now(), id]
  );
  return getAffectedRows(result) > 0;
};

export const revokeClientAccess = async (db: Db, clientId: string) => {
  const timestamp = now();
  await dbRun(db, 'UPDATE oauth_access_tokens SET revoked_at = ? WHERE client_id = ? AND revoked_at IS NULL', [timestamp, clientId]);
  await dbRun(db, 'UPDATE oauth_refresh_tokens SET revoked_at = ? WHERE client_id = ? AND revoked_at IS NULL', [timestamp, clientId]);
  await dbRun(db, 'UPDATE oauth_consents SET revoked_at = ?, updated_at = ? WHERE client_id = ? AND revoked_at IS NULL', [
    timestamp,
    timestamp,
    clientId
  ]);
};
