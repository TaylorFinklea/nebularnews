import { error } from '@sveltejs/kit';
import { isPublicMcpHost } from '$lib/server/mcp/context';
import { isPublicMobileHost, resolveMobileAllowedOrigins } from '$lib/server/mobile/context';
import { assertPublicOauthAudience, type PublicOauthAudience } from './audience';

const OAUTH_CORS_HEADERS = {
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'cache-control': 'no-store',
  pragma: 'no-cache',
  'access-control-max-age': '600'
} as const;

export const assertPublicMcpRequest = (url: URL, env: App.Platform['env']) => {
  if (!isPublicMcpHost(url, env)) {
    throw error(404, 'Not found');
  }
};

export const assertPublicMobileRequest = (url: URL, env: App.Platform['env']) => {
  if (!isPublicMobileHost(url, env)) {
    throw error(404, 'Not found');
  }
};

export const assertPublicOauthRequest = (url: URL, env: App.Platform['env']) => assertPublicOauthAudience(url, env);

const resolvePublicCorsOrigin = (request: Request) => request.headers.get('origin')?.trim() || '*';

const resolveAllowedHeaders = (request: Request) =>
  request.headers.get('access-control-request-headers')?.trim() ||
  'authorization, content-type, accept, cache-control, pragma, x-requested-with';

export const withPublicOauthCors = (response: Response, request: Request, _env: App.Platform['env']) => {
  return withAudienceOauthCors(response, request, _env, null);
};

export const withAudienceOauthCors = (
  response: Response,
  request: Request,
  env: App.Platform['env'],
  audience: PublicOauthAudience | null
) => {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(OAUTH_CORS_HEADERS)) {
    headers.set(key, value);
  }
  const requestOrigin = resolvePublicCorsOrigin(request);
  const allowedOrigins =
    audience === 'mobile'
      ? resolveMobileAllowedOrigins(env)
      : audience === 'mcp'
        ? (env.MCP_PUBLIC_ALLOWED_ORIGINS ?? '')
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean)
        : [];
  const allowOrigin =
    requestOrigin === '*' || allowedOrigins.length === 0 || allowedOrigins.includes(requestOrigin) ? requestOrigin : 'null';
  headers.set('access-control-allow-origin', allowOrigin);
  headers.set('access-control-allow-headers', resolveAllowedHeaders(request));
  headers.set('vary', 'origin, access-control-request-headers');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
};
