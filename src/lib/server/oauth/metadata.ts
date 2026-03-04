import { getConfiguredPublicMcpOrigin, getPublicMcpResource } from '$lib/server/mcp/context';
import { OAUTH_SCOPE_READ } from './storage';

export const getAuthorizationServerIssuer = (env: App.Platform['env']) => getConfiguredPublicMcpOrigin(env);

export const buildProtectedResourceMetadata = (env: App.Platform['env']) => {
  const resource = getPublicMcpResource(env);
  const issuer = getAuthorizationServerIssuer(env);
  if (!resource || !issuer) {
    throw new Error('Public MCP resource metadata is not configured');
  }
  return {
    resource,
    authorization_servers: [issuer],
    scopes_supported: [OAUTH_SCOPE_READ]
  };
};

export const buildAuthorizationServerMetadata = (env: App.Platform['env']) => {
  const issuer = getAuthorizationServerIssuer(env);
  const resource = getPublicMcpResource(env);
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
    scopes_supported: [OAUTH_SCOPE_READ],
    resource
  };
};
