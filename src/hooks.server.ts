import { json, redirect, type Handle } from '@sveltejs/kit';
import { getSessionFromRequest } from '$lib/server/auth';
import { pollFeeds } from '$lib/server/ingest';
import { processJobs } from '$lib/server/jobs';
import { assertSchemaVersion, ensureSchema } from '$lib/server/migrations';
import { createRequestId } from '$lib/server/api';
import { assertRuntimeConfig } from '$lib/server/runtime-config';
import { logError, logInfo, logWarn } from '$lib/server/log';
import { runRetentionCleanup } from '$lib/server/retention';
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
  '/mcp'
];
let runtimeWarningLogged = false;

export const handle: Handle = async ({ event, resolve }) => {
  const { pathname } = event.url;
  const isPublic = publicPaths.some((path) => pathname.startsWith(path)) || pathname.startsWith('/_app');
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
      await assertSchemaVersion(event.platform.env.DB);
    } catch (error) {
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
  ctx.waitUntil(
    (async () => {
      const report = assertRuntimeConfig(env);
      if (!report.ok && report.stage === 'production') {
        logError('scheduled.runtime_config.invalid', {
          stage: report.stage,
          errors: report.errors
        });
        return;
      }
      await ensureSchema(env.DB);
      if (event.cron === '*/5 * * * *') {
        const startedAt = Date.now();
        await processJobs(env);
        logInfo('scheduled.jobs.completed', {
          cron: event.cron,
          duration_ms: Date.now() - startedAt
        });
        return;
      }
      if (event.cron === '30 3 * * *') {
        const startedAt = Date.now();
        const stats = await runRetentionCleanup(env);
        logInfo('scheduled.retention.completed', {
          cron: event.cron,
          duration_ms: Date.now() - startedAt,
          stats
        });
        return;
      }

      const startedAt = Date.now();
      const poll = await pollFeeds(env);
      await processJobs(env);
      logInfo('scheduled.ingest.completed', {
        cron: event.cron,
        duration_ms: Date.now() - startedAt,
        poll
      });
    })()
  );
};
