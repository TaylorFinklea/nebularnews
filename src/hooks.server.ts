import { json, redirect, type Handle, type HandleServerError } from '@sveltejs/kit';
import { getSessionFromRequest } from '$lib/server/auth';
import { assertSchemaVersion } from '$lib/server/migrations';
import { createRequestId } from '$lib/server/api';
import { assertRuntimeConfig } from '$lib/server/runtime-config';
import { logError, logWarn, summarizeError } from '$lib/server/log';
import { runScheduledTasks } from '$lib/server/scheduler';
import { getConfiguredPublicMcpHost, isPublicMcpEnabled, isPublicMcpHost } from '$lib/server/mcp/context';
import { getConfiguredPublicMobileHost, isPublicMobileEnabled, isPublicMobileHost } from '$lib/server/mobile/context';
import {
  applySecurityHeaders,
  buildCsrfCookie,
  createCsrfToken,
  readCsrfCookieFromRequest,
  validateCsrf
} from '$lib/server/security';

const publicPaths = [
  '/login',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/health',
  '/api/ready',
  '/favicon',
  '/robots.txt',
  '/mcp',
  '/oauth',
  '/.well-known/oauth-protected-resource',
  '/.well-known/oauth-authorization-server'
];

const publicMcpHostAllowedPaths = [
  '/mcp',
  '/login',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/health',
  '/.well-known/oauth-protected-resource',
  '/.well-known/oauth-authorization-server',
  '/oauth/authorize',
  '/oauth/token',
  '/oauth/register',
  '/authorize',
  '/token',
  '/register',
  '/favicon',
  '/robots.txt',
  '/nebularnews-logo'
];

const publicMobileHostAllowedPaths = [
  '/api/mobile',
  '/login',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/health',
  '/.well-known/oauth-protected-resource',
  '/.well-known/oauth-authorization-server',
  '/oauth/authorize',
  '/oauth/token',
  '/authorize',
  '/token',
  '/favicon',
  '/robots.txt',
  '/nebularnews-logo'
];
let runtimeWarningLogged = false;
const SCHEMA_ASSERT_CACHE_MS = 1000 * 60 * 5;
let schemaAssertedAt = 0;

export const handle: Handle = async ({ event, resolve }) => {
  const { pathname } = event.url;
  event.locals.requestId = createRequestId();
  let runtimeReport: ReturnType<typeof assertRuntimeConfig>;
  try {
    runtimeReport = assertRuntimeConfig(event.platform.env);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Runtime configuration invalid';
    const headers = new Headers({
      'x-request-id': event.locals.requestId
    });
    const response = pathname.startsWith('/api')
      ? json({ error: message }, { status: 503, headers })
      : new Response(message, { status: 503, headers });
    return applySecurityHeaders(response);
  }
  if (!runtimeWarningLogged && runtimeReport.warnings.length > 0) {
    logWarn('runtime.config.warning', {
      request_id: event.locals.requestId,
      stage: runtimeReport.stage,
      warnings: runtimeReport.warnings
    });
    runtimeWarningLogged = true;
  }
  const isPublicMcpRequest = isPublicMcpHost(event.url, event.platform.env);
  const isPublicMobileRequest = isPublicMobileHost(event.url, event.platform.env);
  const configuredPublicMcpHost = getConfiguredPublicMcpHost(event.platform.env);
  const configuredPublicMobileHost = getConfiguredPublicMobileHost(event.platform.env);
  if (configuredPublicMcpHost && event.url.host === configuredPublicMcpHost) {
    if (!isPublicMcpEnabled(event.platform.env)) {
      return applySecurityHeaders(new Response('Not found', { status: 404 }));
    }
    const allowedOnPublicHost =
      pathname.startsWith('/_app') ||
      publicMcpHostAllowedPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
    if (!allowedOnPublicHost) {
      return applySecurityHeaders(new Response('Not found', { status: 404 }));
    }
  }
  if (configuredPublicMobileHost && event.url.host === configuredPublicMobileHost) {
    if (!isPublicMobileEnabled(event.platform.env)) {
      return applySecurityHeaders(new Response('Not found', { status: 404 }));
    }
    const allowedOnPublicHost =
      pathname.startsWith('/_app') ||
      publicMobileHostAllowedPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
    if (!allowedOnPublicHost) {
      return applySecurityHeaders(new Response('Not found', { status: 404 }));
    }
  }
  const isDevScheduledHandlerPath =
    pathname === '/cdn-cgi/handler/scheduled' && runtimeReport.stage === 'development';
  const isPublic =
    publicPaths.some((path) => pathname.startsWith(path)) ||
    isDevScheduledHandlerPath ||
    isPublicMcpRequest ||
    isPublicMobileRequest ||
    pathname.startsWith('/_app');
  const secureCookie = event.url.protocol === 'https:';

  event.locals.user = await getSessionFromRequest(event.request, event.platform.env.SESSION_SECRET);
  const shouldSetCsrfCookie = Boolean(event.locals.user) && !readCsrfCookieFromRequest(event.request);
  const finalizeWithCsrf = (response: Response) => {
    const headers = new Headers(response.headers);
    headers.set('x-request-id', event.locals.requestId);
    if (shouldSetCsrfCookie) {
      headers.append('set-cookie', buildCsrfCookie(createCsrfToken(), secureCookie));
    }
    return applySecurityHeaders(
      new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
      })
    );
  };

  if (!event.locals.user && !isPublic) {
    if (pathname.startsWith('/api')) {
      return finalizeWithCsrf(json({ error: 'Unauthorized' }, { status: 401 }));
    }
    throw redirect(303, '/login');
  }

  if (!isPublic && pathname !== '/api/health' && pathname !== '/api/ready') {
    try {
      const nowTs = Date.now();
      if (!schemaAssertedAt || nowTs - schemaAssertedAt > SCHEMA_ASSERT_CACHE_MS) {
        await assertSchemaVersion(event.platform.env.DB);
        schemaAssertedAt = nowTs;
      }
    } catch (error) {
      schemaAssertedAt = 0;
      const message = error instanceof Error ? error.message : 'Database schema is not ready';
      if (pathname.startsWith('/api')) {
        return finalizeWithCsrf(json({ error: message }, { status: 503 }));
      }
      return finalizeWithCsrf(new Response(message, { status: 503 }));
    }
  }

  const csrf = validateCsrf(event);
  if (!csrf.ok) {
    return finalizeWithCsrf(json({ error: csrf.message }, { status: csrf.status }));
  }

  return finalizeWithCsrf(await resolve(event));
};

export const scheduled: ExportedHandlerScheduledHandler = async (event, env, ctx) => {
  ctx.waitUntil(runScheduledTasks(env, { cron: event.cron }));
};

export const handleError: HandleServerError = ({ error, event, status, message }) => {
  logError('request.unhandled_exception', {
    request_id: event.locals.requestId ?? null,
    stage: event.platform?.env?.APP_ENV ?? 'development',
    path: event.url.pathname,
    method: event.request.method,
    status,
    message,
    error: summarizeError(error)
  });
  return {
    message: 'Internal Error'
  };
};
