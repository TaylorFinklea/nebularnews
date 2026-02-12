import { json, redirect, type Handle } from '@sveltejs/kit';
import { getSessionFromRequest } from '$lib/server/auth';
import { pollFeeds } from '$lib/server/ingest';
import { processJobs } from '$lib/server/jobs';
import { ensureSchema } from '$lib/server/migrations';

const publicPaths = ['/login', '/api/auth/login', '/api/auth/logout', '/favicon', '/robots.txt'];

export const handle: Handle = async ({ event, resolve }) => {
  const { pathname } = event.url;
  const isPublic = publicPaths.some((path) => pathname.startsWith(path)) || pathname.startsWith('/_app');

  await ensureSchema(event.platform.env.DB);
  event.locals.user = await getSessionFromRequest(event.request, event.platform.env.SESSION_SECRET);

  if (!event.locals.user && !isPublic) {
    if (pathname.startsWith('/api')) {
      return json({ error: 'Unauthorized' }, { status: 401 });
    }
    throw redirect(303, '/login');
  }

  return resolve(event);
};

export const scheduled: ExportedHandlerScheduledHandler = async (event, env, ctx) => {
  ctx.waitUntil(
    (async () => {
      await ensureSchema(env.DB);
      await pollFeeds(env);
      await processJobs(env);
    })()
  );
};
