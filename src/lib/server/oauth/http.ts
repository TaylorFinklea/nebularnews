import { error } from '@sveltejs/kit';
import { isPublicMcpHost } from '$lib/server/mcp/context';

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

const resolvePublicCorsOrigin = (request: Request) => request.headers.get('origin')?.trim() || '*';

const resolveAllowedHeaders = (request: Request) =>
  request.headers.get('access-control-request-headers')?.trim() ||
  'authorization, content-type, accept, cache-control, pragma, x-requested-with';

export const withPublicOauthCors = (response: Response, request: Request, _env: App.Platform['env']) => {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(OAUTH_CORS_HEADERS)) {
    headers.set(key, value);
  }
  headers.set('access-control-allow-origin', resolvePublicCorsOrigin(request));
  headers.set('access-control-allow-headers', resolveAllowedHeaders(request));
  headers.set('vary', 'origin, access-control-request-headers');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
};
