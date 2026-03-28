import type { Db } from '../db';
import { OAUTH_SCOPE_READ, registerOAuthClient } from './storage';

const isHttps = (url: URL) => url.protocol === 'https:';
const isLoopbackHttp = (url: URL) =>
  url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase());

const normalizeRedirectUris = (value: unknown, env: App.Platform['env']) => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('redirect_uris must be a non-empty array');
  }

  const requireHttpsOnly = (env.APP_ENV ?? 'development') === 'production';
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const entry of value) {
    const raw = String(entry ?? '').trim();
    if (!raw) continue;
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      throw new Error('redirect_uris must contain valid absolute URLs');
    }
    if (requireHttpsOnly) {
      if (!isHttps(parsed)) {
        throw new Error('redirect_uris must use HTTPS in production');
      }
    } else if (!isHttps(parsed) && !isLoopbackHttp(parsed)) {
      throw new Error('redirect_uris must use HTTPS or loopback HTTP');
    }
    const normalizedUrl = parsed.toString();
    if (!seen.has(normalizedUrl)) {
      seen.add(normalizedUrl);
      normalized.push(normalizedUrl);
    }
  }

  if (normalized.length === 0) {
    throw new Error('redirect_uris must contain at least one valid URL');
  }
  return normalized;
};

const normalizeScope = (value: unknown) => {
  const raw = String(value ?? '').trim();
  if (!raw) return OAUTH_SCOPE_READ;
  if (raw !== OAUTH_SCOPE_READ) {
    throw new Error(`Only the ${OAUTH_SCOPE_READ} scope is supported`);
  }
  return raw;
};

const normalizeTokenEndpointAuthMethod = (value: unknown) => {
  const raw = String(value ?? 'none').trim() || 'none';
  if (raw !== 'none') {
    throw new Error('Only token_endpoint_auth_method="none" is supported');
  }
  return raw;
};

const normalizeGrantTypes = (value: unknown) => {
  if (value === undefined || value === null) {
    return ['authorization_code', 'refresh_token'];
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('grant_types must be a non-empty array');
  }
  const supported = new Set(['authorization_code', 'refresh_token']);
  const normalized = [...new Set(value.map((entry) => String(entry ?? '').trim()).filter(Boolean))];
  if (normalized.length === 0 || normalized.some((entry) => !supported.has(entry))) {
    throw new Error('Unsupported grant_types');
  }
  return normalized;
};

const normalizeResponseTypes = (value: unknown) => {
  if (value === undefined || value === null) {
    return ['code'];
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('response_types must be a non-empty array');
  }
  const normalized = [...new Set(value.map((entry) => String(entry ?? '').trim()).filter(Boolean))];
  if (normalized.length !== 1 || normalized[0] !== 'code') {
    throw new Error('Only response_types=["code"] is supported');
  }
  return normalized;
};

export const registerDynamicClient = async (
  db: Db,
  env: App.Platform['env'],
  body: unknown
) => {
  const payload = typeof body === 'object' && body && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  if (!payload) {
    throw new Error('Request body must be a JSON object');
  }

  const clientName = String(payload.client_name ?? '').trim();
  if (!clientName) {
    throw new Error('client_name is required');
  }

  const redirectUris = normalizeRedirectUris(payload.redirect_uris, env);
  const grantTypes = normalizeGrantTypes(payload.grant_types);
  const responseTypes = normalizeResponseTypes(payload.response_types);
  const tokenEndpointAuthMethod = normalizeTokenEndpointAuthMethod(payload.token_endpoint_auth_method);
  const scope = normalizeScope(payload.scope);

  const client = await registerOAuthClient(db, {
    clientName,
    redirectUris,
    grantTypes,
    responseTypes,
    tokenEndpointAuthMethod,
    scope
  });

  return {
    client_id: client.clientId,
    client_name: client.clientName,
    redirect_uris: client.redirectUris,
    grant_types: client.grantTypes,
    response_types: client.responseTypes,
    token_endpoint_auth_method: client.tokenEndpointAuthMethod,
    scope: client.scope ?? OAUTH_SCOPE_READ,
    client_id_issued_at: Math.floor(client.createdAt / 1000)
  };
};
