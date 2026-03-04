import { error } from '@sveltejs/kit';
import { isPublicMcpHost, resolveMcpAllowedOrigins } from '$lib/server/mcp/context';

const OAUTH_CORS_HEADERS = {
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type',
  'cache-control': 'no-store'
} as const;

export const assertPublicMcpRequest = (url: URL, env: App.Platform['env']) => {
  if (!isPublicMcpHost(url, env)) {
    throw error(404, 'Not found');
  }
};

const resolvePublicCorsOrigin = (request: Request, env: App.Platform['env']) => {
  const allowedOrigins = resolveMcpAllowedOrigins(env, 'public');
  if (allowedOrigins.length === 0) return '*';
  const origin = request.headers.get('origin')?.trim() ?? '';
  if (!origin) return null;
  if (allowedOrigins.includes(origin)) return origin;
  return '__BLOCKED__';
};

export const withPublicOauthCors = (response: Response, request: Request, env: App.Platform['env']) => {
  const resolvedOrigin = resolvePublicCorsOrigin(request, env);
  if (resolvedOrigin === '__BLOCKED__') {
    return new Response(
      JSON.stringify({
        error: 'Origin not allowed'
      }),
      {
        status: 403,
        headers: {
          'content-type': 'application/json; charset=utf-8'
        }
      }
    );
  }

  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(OAUTH_CORS_HEADERS)) {
    headers.set(key, value);
  }
  if (resolvedOrigin) {
    headers.set('access-control-allow-origin', resolvedOrigin);
    headers.set('vary', 'origin');
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
};
