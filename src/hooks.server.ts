import { json, redirect, type Handle } from '@sveltejs/kit';
import { getSessionFromRequest } from '$lib/server/auth';
import { pollFeeds } from '$lib/server/ingest';
import { processJobs } from '$lib/server/jobs';
import { assertSchemaVersion, ensureSchema } from '$lib/server/migrations';
import { createRequestId } from '$lib/server/api';
import { applySecurityHeaders, validateCsrf } from '$lib/server/security';

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

export const handle: Handle = async ({ event, resolve }) => {
  const { pathname } = event.url;
  const isPublic = publicPaths.some((path) => pathname.startsWith(path)) || pathname.startsWith('/_app');
  event.locals.requestId = createRequestId();
  const finalizeResponse = (response: Response) => {
    response.headers.set('x-request-id', event.locals.requestId);
    return applySecurityHeaders(response);
  };

  event.locals.user = await getSessionFromRequest(event.request, event.platform.env.SESSION_SECRET);

  if (!event.locals.user && !isPublic) {
    if (pathname.startsWith('/api')) {
      return finalizeResponse(json({ error: 'Unauthorized' }, { status: 401 }));
    }
    throw redirect(303, '/login');
  }

  if (!isPublic && pathname !== '/api/health' && pathname !== '/api/ready') {
    try {
      await assertSchemaVersion(event.platform.env.DB);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Database schema is not ready';
      if (pathname.startsWith('/api')) {
        return finalizeResponse(json({ error: message }, { status: 503 }));
      }
      return finalizeResponse(new Response(message, { status: 503 }));
    }
  }

  const csrf = validateCsrf(event);
  if (!csrf.ok) {
    return finalizeResponse(json({ error: csrf.message }, { status: csrf.status }));
  }

  return finalizeResponse(await resolve(event));
};

export const scheduled: ExportedHandlerScheduledHandler = async (event, env, ctx) => {
  ctx.waitUntil(
    (async () => {
      await ensureSchema(env.DB);
      if (event.cron === '*/5 * * * *') {
        await processJobs(env);
        return;
      }

      await pollFeeds(env);
      await processJobs(env);
    })()
  );
};
