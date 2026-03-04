import { error } from '@sveltejs/kit';
import { getPublicMcpResource } from '$lib/server/mcp/context';
import { getAuthorizationServerIssuer } from './metadata';
import {
  OAUTH_SCOPE_READ,
  createAuthorizationCode,
  getOAuthClient,
  grantConsent,
  hasActiveConsent,
  type OAuthClient
} from './storage';

export type OAuthAuthorizeRequest = {
  clientId: string;
  redirectUri: string;
  responseType: 'code';
  scope: string;
  state: string | null;
  resource: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  prompt: string | null;
};

const readSingleParam = (params: URLSearchParams, key: string) => params.get(key)?.trim() ?? '';

const normalizeScope = (rawScope: string) => {
  const scope = rawScope.trim() || OAUTH_SCOPE_READ;
  if (scope !== OAUTH_SCOPE_READ) {
    throw error(400, 'Only the mcp:read scope is supported.');
  }
  return scope;
};

const assertRegisteredRedirectUri = (client: OAuthClient, redirectUri: string) => {
  if (!client.redirectUris.includes(redirectUri)) {
    throw error(400, 'OAuth redirect_uri is not registered for this client.');
  }
};

export const parseAuthorizeRequest = async (
  url: URL,
  db: D1Database,
  env: App.Platform['env']
): Promise<{ request: OAuthAuthorizeRequest; client: OAuthClient }> => {
  const params = url.searchParams;
  const clientId = readSingleParam(params, 'client_id');
  if (!clientId) {
    throw error(400, 'OAuth client_id is required.');
  }

  const client = await getOAuthClient(db, clientId);
  if (!client) {
    throw error(400, 'OAuth client is not registered.');
  }

  const responseType = readSingleParam(params, 'response_type');
  if (responseType !== 'code') {
    throw error(400, 'OAuth response_type=code is required.');
  }

  const redirectUri = readSingleParam(params, 'redirect_uri');
  if (!redirectUri) {
    throw error(400, 'OAuth redirect_uri is required.');
  }
  assertRegisteredRedirectUri(client, redirectUri);

  const resource = readSingleParam(params, 'resource');
  const expectedResource = getPublicMcpResource(env);
  if (!expectedResource) {
    throw error(503, 'Public MCP resource is not configured.');
  }
  if (!resource) {
    throw error(400, 'OAuth resource is required.');
  }
  if (resource !== expectedResource) {
    throw error(400, 'OAuth resource is invalid.');
  }

  const codeChallenge = readSingleParam(params, 'code_challenge');
  if (!codeChallenge) {
    throw error(400, 'OAuth code_challenge is required.');
  }
  const codeChallengeMethod = readSingleParam(params, 'code_challenge_method');
  if (codeChallengeMethod !== 'S256') {
    throw error(400, 'OAuth code_challenge_method must be S256.');
  }

  const scope = normalizeScope(readSingleParam(params, 'scope'));

  return {
    client,
    request: {
      clientId,
      redirectUri,
      responseType: 'code',
      scope,
      state: params.get('state'),
      resource,
      codeChallenge,
      codeChallengeMethod: 'S256',
      prompt: params.get('prompt')
    }
  };
};

const appendAuthParams = (redirectUri: string, values: Record<string, string | null | undefined>) => {
  const destination = new URL(redirectUri);
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === undefined || value === '') continue;
    destination.searchParams.set(key, value);
  }
  return destination.toString();
};

export const buildOAuthErrorRedirect = (
  env: App.Platform['env'],
  redirectUri: string,
  errorCode: string,
  state: string | null,
  description?: string
) =>
  appendAuthParams(redirectUri, {
    error: errorCode,
    state,
    error_description: description ?? null,
    iss: getAuthorizationServerIssuer(env)
  });

export const buildOAuthSuccessRedirect = (
  env: App.Platform['env'],
  redirectUri: string,
  code: string,
  state: string | null
) =>
  appendAuthParams(redirectUri, {
    code,
    state,
    iss: getAuthorizationServerIssuer(env)
  });

export const buildLoginRedirectForAuthorize = (url: URL) => {
  const destination = new URL('/login', url.origin);
  destination.searchParams.set('next', url.toString());
  return destination.toString();
};

export const shouldAutoApproveConsent = async (
  db: D1Database,
  request: OAuthAuthorizeRequest,
  userId: string
) => request.prompt !== 'consent' && (await hasActiveConsent(db, request.clientId, userId, request.scope));

export const approveAuthorizeRequest = async (
  db: D1Database,
  env: App.Platform['env'],
  request: OAuthAuthorizeRequest,
  userId: string
) => {
  await grantConsent(db, request.clientId, userId, request.scope);
  const code = await createAuthorizationCode(db, {
    clientId: request.clientId,
    userId,
    redirectUri: request.redirectUri,
    scope: request.scope,
    resource: request.resource,
    codeChallenge: request.codeChallenge,
    codeChallengeMethod: request.codeChallengeMethod
  });
  return buildOAuthSuccessRedirect(env, request.redirectUri, code, request.state);
};
