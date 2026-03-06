import {
  getOauthIssuerForAudience,
  getOauthResourceForAudience,
  getScopesSupportedForAudience,
  type PublicOauthAudience
} from './audience';

export const getAuthorizationServerIssuer = (env: App.Platform['env'], audience: PublicOauthAudience) =>
  getOauthIssuerForAudience(env, audience);

export const buildProtectedResourceMetadata = (env: App.Platform['env'], audience: PublicOauthAudience) => {
  const resource = getOauthResourceForAudience(env, audience);
  const issuer = getAuthorizationServerIssuer(env, audience);
  if (!resource || !issuer) {
    throw new Error('Public MCP resource metadata is not configured');
  }
  return {
    resource,
    authorization_servers: [issuer],
    scopes_supported: getScopesSupportedForAudience(audience)
  };
};

export const buildAuthorizationServerMetadata = (env: App.Platform['env'], audience: PublicOauthAudience) => {
  const issuer = getAuthorizationServerIssuer(env, audience);
  const resource = getOauthResourceForAudience(env, audience);
  if (!issuer || !resource) {
    throw new Error('Public MCP authorization server is not configured');
  }
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    authorization_response_iss_parameter_supported: true,
    scopes_supported: getScopesSupportedForAudience(audience),
    resource
  };
};
