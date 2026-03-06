import { error } from '@sveltejs/kit';
import { MOBILE_DEFAULT_SCOPE, getConfiguredMobileOauthClient } from './context';
import { getOAuthClient, upsertOAuthClient, type OAuthClient } from '$lib/server/oauth/storage';

export const ensureMobileOAuthClient = async (db: D1Database, env: App.Platform['env']): Promise<OAuthClient> => {
  const configured = getConfiguredMobileOauthClient(env);
  if (!configured) {
    throw error(503, 'Mobile OAuth client is not configured.');
  }

  const existing = await getOAuthClient(db, configured.clientId);
  const nextScope = MOBILE_DEFAULT_SCOPE;

  if (
    existing &&
    existing.clientName === configured.clientName &&
    existing.scope === nextScope &&
    JSON.stringify(existing.redirectUris) === JSON.stringify(configured.redirectUris)
  ) {
    return existing;
  }

  return upsertOAuthClient(db, {
    clientId: configured.clientId,
    clientName: configured.clientName,
    redirectUris: configured.redirectUris,
    grantTypes: ['authorization_code', 'refresh_token'],
    responseTypes: ['code'],
    tokenEndpointAuthMethod: 'none',
    scope: nextScope
  });
};
