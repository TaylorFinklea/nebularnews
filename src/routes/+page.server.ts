import { dev } from '$app/environment';
import { redirect } from '@sveltejs/kit';
import {
  getDashboardFeedStatus,
  getDashboardReadingMomentum,
  getDashboardUnreadQueue
} from '$lib/server/dashboard';
import { getDashboardQueueConfig } from '$lib/server/settings';
import { dbGet } from '$lib/server/db';
import { getDashboardNewsBrief } from '$lib/server/news-brief';
import { logInfo, logWarn } from '$lib/server/log';

const DASHBOARD_LOAD_BUDGET_MS = 1500;
const EMPTY_MOMENTUM = {
  unreadTotal: 0,
  unread24h: 0,
  unread7d: 0,
  highFitUnread7d: 0
};

const DASHBOARD_VISIBLE_REACTIONS = ['up', 'none'];

const buildArticlesHref = (
  options: {
    scoreCutoff?: number;
    sinceDays?: number;
    unreadOnly?: boolean;
    reactions?: string[];
  } = {}
) => {
  const params = new URLSearchParams();

  if (options.unreadOnly !== false) {
    params.set('read', 'unread');
    params.set('sort', 'unread_first');
  }

  if (options.sinceDays && Number.isFinite(options.sinceDays)) {
    params.set('sinceDays', String(Math.max(1, Math.round(options.sinceDays))));
  }

  if (options.scoreCutoff && Number.isFinite(options.scoreCutoff)) {
    const scoreCutoff = Math.max(1, Math.min(5, Math.round(options.scoreCutoff)));
    for (let score = 5; score >= 1; score -= 1) {
      if (score >= scoreCutoff) params.append('score', String(score));
    }
  }

  const reactions = options.reactions ?? DASHBOARD_VISIBLE_REACTIONS;
  for (const r of reactions) params.append('reaction', r);

  return `/articles?${params.toString()}`;
};

const queueArticleHref = (articleId: string, fromPath: string) => {
  return `/articles/${articleId}?from=${encodeURIComponent(fromPath)}`;
};

export const load = async ({ request, depends, setHeaders, locals }) => {
  const userId = locals.user?.id ?? 'admin';
  const startedAt = Date.now();
  depends('app:dashboard');

  const db = locals.db;
  const cache = locals.settingsCache;
  const [queueConfig, feedStatus, newsBrief] = await Promise.all([
    getDashboardQueueConfig(db, cache),
    getDashboardFeedStatus(db),
    getDashboardNewsBrief(db, locals.env, startedAt, userId).catch((error) => {
      logWarn('dashboard.load.news_brief_failed', {
        request_id: locals.requestId ?? null,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    })
  ]);

  const userSubCount = await dbGet<{ cnt: number }>(db, 'SELECT COUNT(*) as cnt FROM user_feed_subscriptions WHERE user_id = ?', [userId]);
  if ((userSubCount?.cnt ?? 0) === 0) {
    throw redirect(303, '/onboarding');
  }

  let readingQueue = [];
  let momentum = { ...EMPTY_MOMENTUM };
  let degraded = false;
  let degradedReason: string | null = null;

  const elapsedBeforeQueue = Date.now() - startedAt;
  if (elapsedBeforeQueue > DASHBOARD_LOAD_BUDGET_MS) {
    degraded = true;
    degradedReason = 'budget_exceeded_before_reading_queue';
  } else {
    try {
      [readingQueue, momentum] = await Promise.all([
        getDashboardUnreadQueue(db, userId, {
          windowDays: queueConfig.windowDays,
          scoreCutoff: queueConfig.scoreCutoff,
          limit: queueConfig.limit,
          referenceAt: startedAt
        }),
        getDashboardReadingMomentum(db, userId, {
          scoreCutoff: queueConfig.scoreCutoff,
          referenceAt: startedAt
        })
      ]);
    } catch (error) {
      degraded = true;
      degradedReason = 'reading_queue_query_failed';
      logWarn('dashboard.load.reading_queue_failed', {
        request_id: locals.requestId ?? null,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const durationMs = Date.now() - startedAt;

  setHeaders({
    'server-timing': `dashboard;dur=${durationMs}`
  });

  const payload = {
    isDev: dev,
    hasFeeds: feedStatus.hasFeeds,
    degraded,
    degradedReason,
    queueConfig: {
      windowDays: queueConfig.windowDays,
      limit: queueConfig.limit,
      scoreCutoff: queueConfig.scoreCutoff,
      hrefUnread: buildArticlesHref(),
      hrefHighFitUnread: buildArticlesHref({
        scoreCutoff: queueConfig.scoreCutoff,
        sinceDays: 7
      }),
      fromHref: buildArticlesHref()
    },
    newsBrief,
    momentumLinks: {
      unreadTotal: buildArticlesHref(),
      unread24h: buildArticlesHref({ sinceDays: 1 }),
      unread7d: buildArticlesHref({ sinceDays: 7 }),
      highFitUnread7d: buildArticlesHref({
        scoreCutoff: queueConfig.scoreCutoff,
        sinceDays: 7
      })
    },
    readingQueue,
    momentum
  };

  logInfo('dashboard.load.completed', {
    request_id: locals.requestId ?? null,
    duration_ms: durationMs,
    degraded,
    degraded_reason: degradedReason,
    has_feeds: payload.hasFeeds,
    news_brief_state: payload.newsBrief?.state ?? null,
    reading_queue_count: payload.readingQueue.length,
    high_fit_count: payload.readingQueue.filter((item) => item.queue_reason === 'high_fit').length,
    unread_total: payload.momentum.unreadTotal
  });

  return payload;
};
