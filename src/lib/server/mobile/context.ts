export const MOBILE_SCOPE_READ = 'app:read';
export const MOBILE_SCOPE_WRITE = 'app:write';
export const MOBILE_SUPPORTED_SCOPES = [MOBILE_SCOPE_READ, MOBILE_SCOPE_WRITE] as const;
export const MOBILE_DEFAULT_SCOPE = `${MOBILE_SCOPE_READ} ${MOBILE_SCOPE_WRITE}`;

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

const parseRedirectUris = (raw: string | undefined) =>
  trim(raw)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

export const isPublicMobileEnabled = (env: App.Platform['env']) => parseBoolean(env.MOBILE_PUBLIC_ENABLED);

export const getConfiguredPublicMobileUrl = (env: App.Platform['env']) => parseUrl(env.MOBILE_PUBLIC_BASE_URL);

export const getConfiguredPublicMobileOrigin = (env: App.Platform['env']) =>
  getConfiguredPublicMobileUrl(env)?.origin ?? null;

export const getConfiguredPublicMobileHost = (env: App.Platform['env']) => getConfiguredPublicMobileUrl(env)?.host ?? null;

export const isConfiguredPublicMobileHost = (url: URL, env: App.Platform['env']) => {
  const expected = getConfiguredPublicMobileHost(env);
  return Boolean(expected) && url.host === expected;
};

export const isPublicMobileHost = (url: URL, env: App.Platform['env']) =>
  isPublicMobileEnabled(env) && isConfiguredPublicMobileHost(url, env);

export const getPublicMobileResource = (env: App.Platform['env']) => {
  const origin = getConfiguredPublicMobileOrigin(env);
  return origin ? `${origin}/api/mobile` : null;
};

export const resolveMobileAllowedOrigins = (env: App.Platform['env']) =>
  trim(env.MOBILE_PUBLIC_ALLOWED_ORIGINS)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

export const getConfiguredMobileOauthClient = (env: App.Platform['env']) => {
  const clientId = trim(env.MOBILE_OAUTH_CLIENT_ID);
  const redirectUris = parseRedirectUris(env.MOBILE_OAUTH_REDIRECT_URIS);
  if (!clientId || redirectUris.length === 0) return null;
  return {
    clientId,
    clientName: trim(env.MOBILE_OAUTH_CLIENT_NAME) || 'Nebular News iOS',
    redirectUris
  };
};

export const hasMobileScope = (grantedScope: string, requiredScope: (typeof MOBILE_SUPPORTED_SCOPES)[number]) =>
  new Set(
    grantedScope
      .split(/\s+/)
      .map((entry) => entry.trim())
      .filter(Boolean)
  ).has(requiredScope);

export const canonicalizeMobileScope = (rawScope: string) => {
  const requested = [...new Set(rawScope.split(/\s+/).map((entry) => entry.trim()).filter(Boolean))];
  const scopes = requested.length > 0 ? requested : [...MOBILE_SUPPORTED_SCOPES];
  for (const scope of scopes) {
    if (!MOBILE_SUPPORTED_SCOPES.includes(scope as (typeof MOBILE_SUPPORTED_SCOPES)[number])) {
      throw new Error(`Unsupported mobile scope: ${scope}`);
    }
  }
  if (!scopes.includes(MOBILE_SCOPE_READ)) {
    throw new Error('Mobile OAuth scope must include app:read.');
  }
  return MOBILE_SUPPORTED_SCOPES.filter((scope) => scopes.includes(scope)).join(' ');
};
