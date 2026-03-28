import { error } from '@sveltejs/kit';
import type { Db } from '../db';
import { ensureMobileOAuthClient } from '$lib/server/mobile/oauth-client';
import {
  getOauthResourceForAudience,
  normalizeScopeForAudience,
  resolvePublicOauthAudience,
  type PublicOauthAudience
} from './audience';
import { getAuthorizationServerIssuer } from './metadata';
import {
  createAuthorizationCode,
  getOAuthClient,
  grantConsent,
  hasActiveConsent,
  type OAuthClient
} from './storage';

export type OAuthAuthorizeRequest = {
  audience: PublicOauthAudience;
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

const assertRegisteredRedirectUri = (client: OAuthClient, redirectUri: string) => {
  if (!client.redirectUris.includes(redirectUri)) {
    throw error(400, 'OAuth redirect_uri is not registered for this client.');
  }
};

export const parseAuthorizeRequest = async (
  url: URL,
  db: Db,
  env: App.Platform['env']
): Promise<{ request: OAuthAuthorizeRequest; client: OAuthClient }> => {
  const audience = resolvePublicOauthAudience(url, env);
  if (!audience) {
    throw error(404, 'Not found');
  }

  const params = url.searchParams;
  const clientId = readSingleParam(params, 'client_id');
  if (!clientId) {
    throw error(400, 'OAuth client_id is required.');
  }

  if (audience === 'mobile') {
    const fixedClient = await ensureMobileOAuthClient(db, env);
    if (fixedClient.clientId !== clientId) {
      throw error(400, 'OAuth client is not registered.');
    }
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
  const expectedResource = getOauthResourceForAudience(env, audience);
  if (!expectedResource) {
    throw error(503, 'Public OAuth resource is not configured.');
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

  const scope = normalizeScopeForAudience(audience, readSingleParam(params, 'scope'));

  return {
    client,
    request: {
      audience,
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
  description?: string,
  audience: PublicOauthAudience = 'mcp'
) =>
  appendAuthParams(redirectUri, {
    error: errorCode,
    state,
    error_description: description ?? null,
    iss: getAuthorizationServerIssuer(env, audience)
  });

export const buildOAuthSuccessRedirect = (
  env: App.Platform['env'],
  redirectUri: string,
  code: string,
  state: string | null,
  audience: PublicOauthAudience = 'mcp'
) =>
  appendAuthParams(redirectUri, {
    code,
    state,
    iss: getAuthorizationServerIssuer(env, audience)
  });

export const buildLoginRedirectForAuthorize = (url: URL) => {
  const destination = new URL('/login', url.origin);
  destination.searchParams.set('next', url.toString());
  return destination.toString();
};

export const shouldAutoApproveConsent = async (
  db: Db,
  request: OAuthAuthorizeRequest,
  userId: string
) => request.prompt !== 'consent' && (await hasActiveConsent(db, request.clientId, userId, request.scope));

export const approveAuthorizeRequest = async (
  db: Db,
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
  return buildOAuthSuccessRedirect(env, request.redirectUri, code, request.state, request.audience);
};

export const buildAuthorizeCardTitle = (audience: PublicOauthAudience) =>
  audience === 'mobile' ? 'Connect Nebular News iOS?' : 'Allow MCP access?';

export const buildAuthorizeCardDescription = (audience: PublicOauthAudience, clientName: string) =>
  audience === 'mobile'
    ? `${clientName} wants companion-app access to your Nebular News server.`
    : `${clientName} wants read-only access to Nebular News through the public MCP server.`;

export const buildAuthorizeCardWarning = (audience: PublicOauthAudience) =>
  audience === 'mobile'
    ? 'Allowing access lets the iOS companion app read your dashboard/articles and update read state, reactions, and manual tags.'
    : 'Allowing access lets this client search and read article context from Nebular News. No write tools are exposed.';
