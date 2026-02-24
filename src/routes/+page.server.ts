import { dev } from '$app/environment';
import {
  buildTopRatedScoreQuery,
  getDashboardStats,
  getDashboardTopRatedArticles,
  resolveDashboardDayRange
} from '$lib/server/dashboard';
import {
  getDashboardTopRatedConfig,
  getDashboardTopRatedLayout
} from '$lib/server/settings';
import { logInfo, logWarn } from '$lib/server/log';

const DASHBOARD_LOAD_BUDGET_MS = 1500;

export const load = async ({ platform, request, depends, setHeaders, locals }) => {
  const startedAt = Date.now();
  depends('app:dashboard');

  const db = platform.env.DB;
  const dashboardTopRated = await getDashboardTopRatedConfig(db);
  const dashboardTopRatedLayout = await getDashboardTopRatedLayout(db);
  const scoreCutoff = dashboardTopRated.cutoff;
  const topRatedLimit = dashboardTopRated.limit;
  const range = resolveDashboardDayRange(request.headers.get('cookie'));

  const { stats, today } = await getDashboardStats(db, range);
  let topRatedArticles = [];
  let degraded = false;
  let degradedReason: string | null = null;

  const elapsedAfterStats = Date.now() - startedAt;
  if (elapsedAfterStats > DASHBOARD_LOAD_BUDGET_MS) {
    degraded = true;
    degradedReason = 'budget_exceeded_before_top_rated';
  } else {
    try {
      topRatedArticles = await getDashboardTopRatedArticles(db, range, {
        scoreCutoff,
        limit: topRatedLimit
      });
    } catch (error) {
      degraded = true;
      degradedReason = 'top_rated_query_failed';
      logWarn('dashboard.load.top_rated_failed', {
        request_id: locals.requestId ?? null,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const topRatedScoreQuery = buildTopRatedScoreQuery(scoreCutoff);
  const durationMs = Date.now() - startedAt;

  setHeaders({
    'server-timing': `dashboard;dur=${durationMs}`
  });

  const payload = {
    isDev: dev,
    stats,
    today,
    degraded,
    degradedReason,
    topRatedConfig: {
      scoreCutoff,
      limit: topRatedLimit,
      layout: dashboardTopRatedLayout,
      href: topRatedScoreQuery ? `/articles?${topRatedScoreQuery}` : '/articles'
    },
    topRatedArticles
  };

  logInfo('dashboard.load.completed', {
    request_id: locals.requestId ?? null,
    duration_ms: durationMs,
    degraded,
    degraded_reason: degradedReason,
    today_articles: payload.today.articles,
    today_pending_jobs: payload.today.pendingJobs,
    top_rated_count: payload.topRatedArticles.length
  });

  return payload;
};
