import { apiOkWithAliases } from '$lib/server/api';
import { dbGet } from '$lib/server/db';
import { getDashboardStats, resolveDashboardDayRange } from '$lib/server/dashboard';
import { getManualPullState } from '$lib/server/manual-pull';

export const GET = async (event) => {
  const startedAt = Date.now();
  const db = event.platform.env.DB;
  const range = resolveDashboardDayRange(event.request.headers.get('cookie'));
  const [{ today }, pull, counts] = await Promise.all([
    getDashboardStats(db, range),
    getManualPullState(db),
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
    )
  ]);

  const durationMs = Date.now() - startedAt;
  const data = {
    today,
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
    refreshed_at: Date.now()
  };

  return apiOkWithAliases(
    event,
    data,
    {
      ...data,
      server_timing_ms: durationMs
    },
    {
      'server-timing': `dashboard_live;dur=${durationMs}`
    }
  );
};
