import { json, redirect, type Handle, type HandleServerError } from '@sveltejs/kit';
import { getSessionFromRequest, getSupabaseSessionFromRequest } from '$lib/server/auth';
import { assertSchemaVersion } from '$lib/server/migrations';
import { createRequestId } from '$lib/server/api';
import { assertRuntimeConfig } from '$lib/server/runtime-config';
import { logError, logWarn, summarizeError } from '$lib/server/log';
import { getConfiguredPublicMcpHost, isPublicMcpEnabled, isPublicMcpHost } from '$lib/server/mcp/context';
import { getConfiguredPublicMobileHost, isPublicMobileEnabled, isPublicMobileHost } from '$lib/server/mobile/context';
import {
  applySecurityHeaders,
  buildCsrfCookie,
  createCsrfToken,
  readCsrfCookieFromRequest,
  validateCsrf
} from '$lib/server/security';
import { createDb } from '$lib/server/db';
import { getEnv, type Env } from '$lib/server/env';
import { runScheduledTasks } from '$lib/server/scheduler';
import { loadSettingsCache } from '$lib/server/settings';

const publicPaths = [
  '/login',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/health',
  '/api/ready',
  '/api/db-test',
  '/api/db-test/settings',
  '/api/db-test/articles',
  '/favicon',
  '/robots.txt',
  '/mcp',
  '/oauth',
  '/auth',
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
  '/auth',
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
  const env = getEnv(event.platform.env);
  event.locals.requestId = createRequestId();
  event.locals.env = env;

  // Forward magic link tokens to /auth/callback (Supabase may redirect to root)
  if (event.url.searchParams.has('token_hash') && !pathname.startsWith('/auth/callback')) {
    const callbackUrl = new URL('/auth/callback', event.url.origin);
    callbackUrl.search = event.url.search;
    throw redirect(303, callbackUrl.pathname + callbackUrl.search);
  }

  // Lazy db creation — only connects when first accessed
  let _db: ReturnType<typeof createDb> | undefined;
  Object.defineProperty(event.locals, 'db', {
    get() {
      if (!_db) {
        const connStr = (event.platform?.env as any)?.HYPERDRIVE?.connectionString ?? env.SUPABASE_DB_URL;
        _db = createDb(connStr);
      }
      return _db;
    },
    configurable: true
  });

  let runtimeReport: ReturnType<typeof assertRuntimeConfig>;
  try {
    runtimeReport = assertRuntimeConfig(env);
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
  const isPublicMcpRequest = isPublicMcpHost(event.url, env);
  const isPublicMobileRequest = isPublicMobileHost(event.url, env);
  const configuredPublicMcpHost = getConfiguredPublicMcpHost(env);
  const configuredPublicMobileHost = getConfiguredPublicMobileHost(env);
  if (configuredPublicMcpHost && event.url.host === configuredPublicMcpHost) {
    if (!isPublicMcpEnabled(env)) {
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
    if (!isPublicMobileEnabled(env)) {
      return applySecurityHeaders(new Response('Not found', { status: 404 }));
    }
    const allowedOnPublicHost =
      pathname.startsWith('/_app') ||
      publicMobileHostAllowedPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
    if (!allowedOnPublicHost) {
      return applySecurityHeaders(new Response('Not found', { status: 404 }));
    }
  }
  const isPublic =
    publicPaths.some((path) => pathname.startsWith(path)) ||
    isPublicMcpRequest ||
    isPublicMobileRequest ||
    pathname.startsWith('/_app');
  const secureCookie = event.url.protocol === 'https:';

  // Try admin-password session first, then Supabase JWT
  const adminSession = await getSessionFromRequest(event.request, env.SESSION_SECRET);
  const supabaseSession = adminSession
    ? null
    : await getSupabaseSessionFromRequest(event.request, event.locals.db, env);
  event.locals.user = adminSession ?? supabaseSession;
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
        await assertSchemaVersion(event.locals.db);
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

  // Load settings cache once per request — eliminates dozens of individual queries
  if (event.locals.user && !isPublic) {
    event.locals.settingsCache = await loadSettingsCache(event.locals.db);
  }

  const csrf = validateCsrf(event);
  if (!csrf.ok) {
    return finalizeWithCsrf(json({ error: csrf.message }, { status: csrf.status }));
  }

  try {
    return finalizeWithCsrf(await resolve(event));
  } catch (err) {
    // Re-throw SvelteKit redirects/errors as-is
    if (err && typeof err === 'object' && ('status' in err || 'location' in err)) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    logError('hooks.resolve.error', { path: pathname, error: msg });
    return finalizeWithCsrf(json({ error: msg }, { status: 500 }));
  }
};

export const scheduled: ExportedHandlerScheduledHandler = async (event, env, ctx) => {
  const db = createDb(env.SUPABASE_DB_URL);
  ctx.waitUntil(runScheduledTasks(db, env as unknown as Env, { cron: event.cron }));
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
