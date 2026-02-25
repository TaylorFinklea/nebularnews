import { json, redirect, type Handle, type HandleServerError } from '@sveltejs/kit';
import { getSessionFromRequest } from '$lib/server/auth';
import { pollFeeds } from '$lib/server/ingest';
import { processJobs } from '$lib/server/jobs';
import { processPullRuns, recoverStalePullRuns } from '$lib/server/manual-pull';
import { queueMissingTodayArticleJobs } from '$lib/server/jobs-admin';
import { assertSchemaVersion, ensureSchema } from '$lib/server/migrations';
import { createRequestId } from '$lib/server/api';
import { assertRuntimeConfig } from '$lib/server/runtime-config';
import { logError, logInfo, logWarn, summarizeError } from '$lib/server/log';
import { runRetentionCleanup } from '$lib/server/retention';
import {
  DEFAULT_SCHEDULED_ORPHAN_CLEANUP_LIMIT,
  deleteOrphanArticlesBatch
} from '$lib/server/orphan-cleanup';
import {
  getSchedulerRuntimeConfig,
  intervalMinutesToCronExpression
} from '$lib/server/settings';
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
const SCHEMA_ASSERT_CACHE_MS = 1000 * 60 * 5;
let schemaAssertedAt = 0;
const RETENTION_CRON = '30 3 * * *';
const LEGACY_JOBS_CRON = '*/5 * * * *';
const LEGACY_POLL_CRON = '0 * * * *';

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
      const scheduler = await getSchedulerRuntimeConfig(env.DB);
      const jobsCron = intervalMinutesToCronExpression(scheduler.jobsIntervalMinutes);
      const pollCron = intervalMinutesToCronExpression(scheduler.pollIntervalMinutes);
      const isJobsTick = event.cron === jobsCron || event.cron === LEGACY_JOBS_CRON;
      const isPollTick = event.cron === pollCron || event.cron === LEGACY_POLL_CRON;

      if (isJobsTick) {
        const startedAt = Date.now();
        await recoverStalePullRuns(env.DB);
        const pull = await processPullRuns(env, {
          maxSlices: scheduler.pullSlicesPerTick,
          timeBudgetMs: scheduler.pullSliceBudgetMs
        });
        const latestPullSlice = pull.slices.length > 0 ? pull.slices[pull.slices.length - 1] : null;
        const pullRunning = latestPullSlice?.status === 'running';
        let queuedToday = null;
        if (!pullRunning && scheduler.autoQueueTodayMissing) {
          queuedToday = await queueMissingTodayArticleJobs(env.DB, { tzOffsetMinutes: 0 });
        }
        await processJobs(env, {
          timeBudgetMs: pullRunning ? scheduler.jobBudgetWhilePullMs : scheduler.jobBudgetIdleMs
        });
        let orphanCleanup = null;
        if (!pullRunning) {
          const orphanCleanupStartedAt = Date.now();
          orphanCleanup = await deleteOrphanArticlesBatch(env.DB, DEFAULT_SCHEDULED_ORPHAN_CLEANUP_LIMIT, {
            dryRun: false
          });
          logInfo('scheduled.orphans.cleanup', {
            cron: event.cron,
            duration_ms: Date.now() - orphanCleanupStartedAt,
            targeted: orphanCleanup.targeted,
            deleted_articles: orphanCleanup.deleted_articles,
            orphan_count_after: orphanCleanup.orphan_count_after,
            has_more: orphanCleanup.has_more
          });
        }
        logInfo('scheduled.jobs.completed', {
          cron: event.cron,
          duration_ms: Date.now() - startedAt,
          pull_processed: pull.processed,
          pull_slices: pull.slices.length,
          pull_status: latestPullSlice?.status ?? null,
          jobs_processed: true,
          scheduler,
          queued_today: queuedToday,
          orphan_cleanup: orphanCleanup
        });
      }
      if (event.cron === RETENTION_CRON) {
        const startedAt = Date.now();
        const stats = await runRetentionCleanup(env);
        logInfo('scheduled.retention.completed', {
          cron: event.cron,
          duration_ms: Date.now() - startedAt,
          stats
        });
        return;
      }

      if (isPollTick) {
        const startedAt = Date.now();
        const poll = await pollFeeds(env);
        logInfo('scheduled.poll.completed', {
          cron: event.cron,
          duration_ms: Date.now() - startedAt,
          scheduler,
          poll
        });
      }
    })()
  );
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
