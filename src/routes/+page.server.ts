import { dev } from '$app/environment';
import {
  getDashboardFeedStatus,
  getDashboardReadingMomentum,
  getDashboardUnreadQueue
} from '$lib/server/dashboard';
import { getDashboardQueueConfig } from '$lib/server/settings';
import { logInfo, logWarn } from '$lib/server/log';

const DASHBOARD_LOAD_BUDGET_MS = 1500;
const EMPTY_MOMENTUM = {
  unreadTotal: 0,
  unread24h: 0,
  unread7d: 0,
  highFitUnread7d: 0
};

const buildHighFitUnreadHref = (scoreCutoff: number) => {
  const params = new URLSearchParams();
  params.set('read', 'unread');
  params.set('sort', 'unread_first');

  for (let score = 5; score >= 1; score -= 1) {
    if (score >= scoreCutoff) params.append('score', String(score));
  }

  return `/articles?${params.toString()}`;
};

export const load = async ({ platform, request, depends, setHeaders, locals }) => {
  const startedAt = Date.now();
  depends('app:dashboard');

  const db = platform.env.DB;
  const [queueConfig, feedStatus] = await Promise.all([
    getDashboardQueueConfig(db),
    getDashboardFeedStatus(db)
  ]);

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
        getDashboardUnreadQueue(db, {
          windowDays: queueConfig.windowDays,
          scoreCutoff: queueConfig.scoreCutoff,
          limit: queueConfig.limit,
          referenceAt: startedAt
        }),
        getDashboardReadingMomentum(db, {
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
      hrefUnread: '/articles?read=unread&sort=unread_first',
      hrefHighFitUnread: buildHighFitUnreadHref(queueConfig.scoreCutoff)
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
    reading_queue_count: payload.readingQueue.length,
    high_fit_count: payload.readingQueue.filter((item) => item.queue_reason === 'high_fit').length,
    unread_total: payload.momentum.unreadTotal
  });

  return payload;
};
