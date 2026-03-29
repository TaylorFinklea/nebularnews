import type { Env } from '../env';

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

export const isPublicMcpEnabled = (env: Env) => parseBoolean(env.MCP_PUBLIC_ENABLED);

export const getConfiguredPublicMcpUrl = (env: Env) => parseUrl(env.MCP_PUBLIC_BASE_URL);

export const getConfiguredPublicMcpOrigin = (env: Env) => getConfiguredPublicMcpUrl(env)?.origin ?? null;

export const getConfiguredPublicMcpHost = (env: Env) => getConfiguredPublicMcpUrl(env)?.host ?? null;

export const isConfiguredPublicMcpHost = (url: URL, env: Env) => {
  const expected = getConfiguredPublicMcpHost(env);
  return Boolean(expected) && url.host === expected;
};

export const isPublicMcpHost = (url: URL, env: Env) =>
  isPublicMcpEnabled(env) && isConfiguredPublicMcpHost(url, env);

export const resolveMcpAudience = (url: URL, env: Env): McpAudience =>
  isPublicMcpHost(url, env) ? 'public' : 'internal';

export const getPublicMcpResource = (env: Env) => {
  const origin = getConfiguredPublicMcpOrigin(env);
  return origin ? `${origin}/mcp` : null;
};

export const getProtectedResourceMetadataUrl = (env: Env) => {
  const origin = getConfiguredPublicMcpOrigin(env);
  return origin ? `${origin}/.well-known/oauth-protected-resource` : null;
};

export const parseAllowedOrigins = (raw: string | undefined) =>
  trim(raw)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

export const resolveMcpAllowedOrigins = (env: Env, audience: McpAudience) =>
  parseAllowedOrigins(audience === 'public' ? env.MCP_PUBLIC_ALLOWED_ORIGINS : env.MCP_ALLOWED_ORIGINS);
