import { error } from '@sveltejs/kit';
import {
  MOBILE_DEFAULT_SCOPE,
  MOBILE_SCOPE_READ,
  MOBILE_SCOPE_WRITE,
  MOBILE_SUPPORTED_SCOPES,
  canonicalizeMobileScope
} from '$lib/server/mobile/context';
import { getConfiguredPublicMcpOrigin, getProtectedResourceMetadataUrl, getPublicMcpResource, isPublicMcpHost } from '$lib/server/mcp/context';
import {
  getConfiguredPublicMobileOrigin,
  getPublicMobileResource,
  isPublicMobileHost
} from '$lib/server/mobile/context';

export type PublicOauthAudience = 'mcp' | 'mobile';

export const OAUTH_SCOPE_READ = 'mcp:read';

export const resolvePublicOauthAudience = (url: URL, env: App.Platform['env']): PublicOauthAudience | null => {
  if (isPublicMcpHost(url, env)) return 'mcp';
  if (isPublicMobileHost(url, env)) return 'mobile';
  return null;
};

export const assertPublicOauthAudience = (url: URL, env: App.Platform['env']): PublicOauthAudience => {
  const audience = resolvePublicOauthAudience(url, env);
  if (!audience) {
    throw error(404, 'Not found');
  }
  return audience;
};

export const getOauthIssuerForAudience = (env: App.Platform['env'], audience: PublicOauthAudience) =>
  audience === 'mcp' ? getConfiguredPublicMcpOrigin(env) : getConfiguredPublicMobileOrigin(env);

export const getOauthResourceForAudience = (env: App.Platform['env'], audience: PublicOauthAudience) =>
  audience === 'mcp' ? getPublicMcpResource(env) : getPublicMobileResource(env);

export const getProtectedResourceMetadataUrlForAudience = (env: App.Platform['env'], audience: PublicOauthAudience) => {
  if (audience === 'mcp') return getProtectedResourceMetadataUrl(env);
  const origin = getConfiguredPublicMobileOrigin(env);
  return origin ? `${origin}/.well-known/oauth-protected-resource` : null;
};

export const getScopesSupportedForAudience = (audience: PublicOauthAudience) =>
  audience === 'mcp' ? [OAUTH_SCOPE_READ] : [...MOBILE_SUPPORTED_SCOPES];

export const getDefaultScopeForAudience = (audience: PublicOauthAudience) =>
  audience === 'mcp' ? OAUTH_SCOPE_READ : MOBILE_DEFAULT_SCOPE;

export const normalizeScopeForAudience = (audience: PublicOauthAudience, rawScope: string) => {
  if (audience === 'mcp') {
    const scope = rawScope.trim() || OAUTH_SCOPE_READ;
    if (scope !== OAUTH_SCOPE_READ) {
      throw error(400, 'Only the mcp:read scope is supported.');
    }
    return scope;
  }

  try {
    return canonicalizeMobileScope(rawScope);
  } catch (cause) {
    throw error(400, cause instanceof Error ? cause.message : 'Invalid mobile OAuth scope.');
  }
};

export const hasRequiredScope = (grantedScope: string, requiredScope: string) =>
  new Set(
    grantedScope
      .split(/\s+/)
      .map((entry) => entry.trim())
      .filter(Boolean)
  ).has(requiredScope);

export const canRegisterDynamicClient = (audience: PublicOauthAudience) => audience === 'mcp';

export const isMobileWriteScope = (scope: string) => scope === MOBILE_SCOPE_WRITE;
export const isMobileReadScope = (scope: string) => scope === MOBILE_SCOPE_READ;
