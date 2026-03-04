import { error } from '@sveltejs/kit';
import { getPublicMcpResource } from '$lib/server/mcp/context';
import { verifyPkceS256 } from './crypto';
import {
  OAUTH_ACCESS_TOKEN_TTL_MS,
  OAUTH_SCOPE_READ,
  getAccessTokenByRawToken,
  getAuthorizationCodeByRawCode,
  getOAuthClient,
  getRefreshTokenByRawToken,
  issueTokenPair,
  markAuthorizationCodeUsed,
  revokeRefreshToken,
  touchAccessToken
} from './storage';

const readRequiredFormValue = (form: URLSearchParams, key: string) => {
  const value = form.get(key)?.trim() ?? '';
  if (!value) {
    throw error(400, `OAuth ${key} is required.`);
  }
  return value;
};

const readOptionalFormValue = (form: URLSearchParams, key: string) => form.get(key)?.trim() ?? '';

const validateClientRedirectUri = async (clientId: string, redirectUri: string, db: D1Database) => {
  const client = await getOAuthClient(db, clientId);
  if (!client) {
    throw error(400, 'OAuth client is not registered.');
  }
  if (!client.redirectUris.includes(redirectUri)) {
    throw error(400, 'OAuth redirect_uri is invalid for this client.');
  }
  return client;
};

const ensureSupportedScope = (scope: string) => {
  if (scope !== OAUTH_SCOPE_READ) {
    throw error(400, 'Only the mcp:read scope is supported.');
  }
};

export const exchangeAuthorizationCodeGrant = async (
  db: D1Database,
  env: App.Platform['env'],
  form: URLSearchParams
) => {
  const code = readRequiredFormValue(form, 'code');
  const clientId = readRequiredFormValue(form, 'client_id');
  const codeVerifier = readRequiredFormValue(form, 'code_verifier');
  const authCode = await getAuthorizationCodeByRawCode(db, code);
  if (!authCode) {
    throw error(400, 'OAuth authorization code is invalid.');
  }

  const redirectUri = readOptionalFormValue(form, 'redirect_uri') || authCode.redirect_uri;
  const resource = readOptionalFormValue(form, 'resource') || authCode.resource;
  const expectedResource = getPublicMcpResource(env);
  if (!expectedResource || resource !== expectedResource) {
    throw error(400, 'OAuth resource is invalid.');
  }

  await validateClientRedirectUri(clientId, redirectUri, db);
  if (authCode.client_id !== clientId) {
    throw error(400, 'OAuth authorization code client mismatch.');
  }
  if (authCode.redirect_uri !== redirectUri) {
    throw error(400, 'OAuth redirect_uri mismatch.');
  }
  if (authCode.resource !== resource) {
    throw error(400, 'OAuth resource mismatch.');
  }
  ensureSupportedScope(authCode.scope);
  if (authCode.used_at) {
    throw error(400, 'OAuth authorization code has already been used.');
  }
  if (authCode.expires_at <= Date.now()) {
    throw error(400, 'OAuth authorization code has expired.');
  }
  if (authCode.code_challenge_method !== 'S256') {
    throw error(400, 'OAuth code challenge method is unsupported.');
  }
  if (!(await verifyPkceS256(codeVerifier, authCode.code_challenge))) {
    throw error(400, 'OAuth PKCE verifier is invalid.');
  }

  const claimed = await markAuthorizationCodeUsed(db, authCode.id);
  if (!claimed) {
    throw error(400, 'OAuth authorization code has already been used.');
  }

  const issued = await issueTokenPair(db, {
    clientId: authCode.client_id,
    userId: authCode.user_id,
    scope: authCode.scope,
    resource: authCode.resource
  });

  return {
    access_token: issued.accessToken,
    token_type: 'Bearer',
    expires_in: Math.floor(OAUTH_ACCESS_TOKEN_TTL_MS / 1000),
    refresh_token: issued.refreshToken,
    scope: authCode.scope,
    resource: authCode.resource
  };
};

export const exchangeRefreshTokenGrant = async (
  db: D1Database,
  env: App.Platform['env'],
  form: URLSearchParams
) => {
  const refreshToken = readRequiredFormValue(form, 'refresh_token');
  const clientId = readRequiredFormValue(form, 'client_id');
  const resource = form.get('resource')?.trim() || getPublicMcpResource(env);
  const expectedResource = getPublicMcpResource(env);
  if (!expectedResource || resource !== expectedResource) {
    throw error(400, 'OAuth resource is invalid.');
  }

  const client = await getOAuthClient(db, clientId);
  if (!client) {
    throw error(400, 'OAuth client is not registered.');
  }

  const token = await getRefreshTokenByRawToken(db, refreshToken);
  if (!token) {
    throw error(400, 'OAuth refresh token is invalid.');
  }
  if (token.client_id !== clientId) {
    throw error(400, 'OAuth refresh token client mismatch.');
  }
  if (token.resource !== resource) {
    throw error(400, 'OAuth refresh token resource mismatch.');
  }
  ensureSupportedScope(token.scope);
  if (token.revoked_at) {
    throw error(400, 'OAuth refresh token has been revoked.');
  }
  if (token.expires_at <= Date.now()) {
    throw error(400, 'OAuth refresh token has expired.');
  }

  await revokeRefreshToken(db, token.id);
  const issued = await issueTokenPair(db, {
    clientId: token.client_id,
    userId: token.user_id,
    scope: token.scope,
    resource: token.resource,
    refreshTokenFromId: token.id
  });

  return {
    access_token: issued.accessToken,
    token_type: 'Bearer',
    expires_in: Math.floor(OAUTH_ACCESS_TOKEN_TTL_MS / 1000),
    refresh_token: issued.refreshToken,
    scope: token.scope,
    resource: token.resource
  };
};

export const authenticatePublicAccessToken = async (
  db: D1Database,
  env: App.Platform['env'],
  rawToken: string | null
) => {
  if (!rawToken) {
    return null;
  }
  const token = await getAccessTokenByRawToken(db, rawToken);
  if (!token) {
    return null;
  }
  if (token.revoked_at || token.expires_at <= Date.now()) {
    return null;
  }
  const expectedResource = getPublicMcpResource(env);
  if (!expectedResource || token.resource !== expectedResource) {
    return null;
  }
  if (token.scope !== OAUTH_SCOPE_READ) {
    return null;
  }
  await touchAccessToken(db, token.id, token.client_id);
  return token;
};
