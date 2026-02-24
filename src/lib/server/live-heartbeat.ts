import { dbGet, type Db } from '$lib/server/db';
import { type DashboardTodayStats, getDashboardStats, resolveDashboardDayRange } from '$lib/server/dashboard';
import { getManualPullState } from '$lib/server/manual-pull';
import { logWarn } from '$lib/server/log';

const DEFAULT_HEARTBEAT_BUDGET_MS = 1_200;

const createEmptyToday = (tzOffsetMinutes: number): DashboardTodayStats => ({
  articles: 0,
  summaries: 0,
  scores: 0,
  pendingJobs: 0,
  missingSummaries: 0,
  missingScores: 0,
  tzOffsetMinutes
});

const getJobCounts = async (db: Db) =>
  dbGet<{
    pending: number | null;
    running: number | null;
    failed: number | null;
    done: number | null;
  }>(
    db,
    `SELECT
      COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) as pending,
      COALESCE(SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END), 0) as running,
      COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) as failed,
      COALESCE(SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END), 0) as done
     FROM jobs`
  );

export type LiveHeartbeatPayload = {
  pull: {
    run_id: string | null;
    status: string | null;
    in_progress: boolean;
    started_at: number | null;
    completed_at: number | null;
    last_run_status: 'success' | 'failed' | null;
    last_error: string | null;
  };
  jobs: {
    pending: number;
    running: number;
    failed: number;
    done: number;
  };
  today: DashboardTodayStats;
  refreshed_at: number;
  degraded: boolean;
  degraded_reason: string | null;
};

export async function getLiveHeartbeat(
  db: Db,
  cookieHeader: string | null,
  options: {
    requestId?: string | null;
    budgetMs?: number;
    startedAt?: number;
  } = {}
): Promise<LiveHeartbeatPayload> {
  const startedAt = options.startedAt ?? Date.now();
  const budgetMs = Math.max(250, options.budgetMs ?? DEFAULT_HEARTBEAT_BUDGET_MS);
  const range = resolveDashboardDayRange(cookieHeader, startedAt);
  let degraded = false;
  let degradedReason: string | null = null;

  const [pull, counts] = await Promise.all([getManualPullState(db), getJobCounts(db)]);

  let today = createEmptyToday(range.tzOffsetMinutes);
  const elapsedBeforeToday = Date.now() - startedAt;
  if (elapsedBeforeToday >= budgetMs) {
    degraded = true;
    degradedReason = 'budget_exceeded_before_today';
  } else {
    try {
      const stats = await getDashboardStats(db, range);
      today = stats.today;
    } catch (error) {
      degraded = true;
      degradedReason = 'today_stats_failed';
      logWarn('live.heartbeat.today_failed', {
        request_id: options.requestId ?? null,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  if (!degraded && Date.now() - startedAt > budgetMs) {
    degraded = true;
    degradedReason = 'budget_exceeded_after_today';
  }

  return {
    pull: {
      run_id: pull.runId,
      status: pull.status,
      in_progress: pull.inProgress,
      started_at: pull.startedAt,
      completed_at: pull.completedAt,
      last_run_status: pull.lastRunStatus,
      last_error: pull.lastError
    },
    jobs: {
      pending: Number(counts?.pending ?? 0),
      running: Number(counts?.running ?? 0),
      failed: Number(counts?.failed ?? 0),
      done: Number(counts?.done ?? 0)
    },
    today,
    refreshed_at: Date.now(),
    degraded,
    degraded_reason: degradedReason
  };
}
