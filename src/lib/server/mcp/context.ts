export type McpAudience = 'internal' | 'public';

const trim = (value: string | undefined) => value?.trim() ?? '';

const parseBoolean = (value: string | undefined) => ['1', 'true', 'yes', 'on'].includes(trim(value).toLowerCase());

const parseUrl = (value: string | undefined) => {
  const normalized = trim(value);
  if (!normalized) return null;
  try {
    return new URL(normalized);
  } catch {
    return null;
  }
};

export const isPublicMcpEnabled = (env: App.Platform['env']) => parseBoolean(env.MCP_PUBLIC_ENABLED);

export const getConfiguredPublicMcpUrl = (env: App.Platform['env']) => parseUrl(env.MCP_PUBLIC_BASE_URL);

export const getConfiguredPublicMcpOrigin = (env: App.Platform['env']) => getConfiguredPublicMcpUrl(env)?.origin ?? null;

export const getConfiguredPublicMcpHost = (env: App.Platform['env']) => getConfiguredPublicMcpUrl(env)?.host ?? null;

export const isConfiguredPublicMcpHost = (url: URL, env: App.Platform['env']) => {
  const expected = getConfiguredPublicMcpHost(env);
  return Boolean(expected) && url.host === expected;
};

export const isPublicMcpHost = (url: URL, env: App.Platform['env']) =>
  isPublicMcpEnabled(env) && isConfiguredPublicMcpHost(url, env);

export const resolveMcpAudience = (url: URL, env: App.Platform['env']): McpAudience =>
  isPublicMcpHost(url, env) ? 'public' : 'internal';

export const getPublicMcpResource = (env: App.Platform['env']) => {
  const origin = getConfiguredPublicMcpOrigin(env);
  return origin ? `${origin}/mcp` : null;
};

export const getProtectedResourceMetadataUrl = (env: App.Platform['env']) => {
  const origin = getConfiguredPublicMcpOrigin(env);
  return origin ? `${origin}/.well-known/oauth-protected-resource` : null;
};

export const parseAllowedOrigins = (raw: string | undefined) =>
  trim(raw)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

export const resolveMcpAllowedOrigins = (env: App.Platform['env'], audience: McpAudience) =>
  parseAllowedOrigins(audience === 'public' ? env.MCP_PUBLIC_ALLOWED_ORIGINS : env.MCP_ALLOWED_ORIGINS);
