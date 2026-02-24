import { json } from '@sveltejs/kit';
import { getManualPullState } from '$lib/server/manual-pull';
import { logInfo, logWarn } from '$lib/server/log';

const PULL_STATUS_ROUTE_BUDGET_MS = 800;

export const GET = async ({ platform, url, locals }) => {
  const startedAt = Date.now();
  const runId = url.searchParams.get('run_id')?.trim() || null;
  try {
    const state = await getManualPullState(platform.env.DB, runId);
    const durationMs = Date.now() - startedAt;
    const degraded = durationMs > PULL_STATUS_ROUTE_BUDGET_MS;
    logInfo('pull.status.completed', {
      request_id: locals.requestId,
      duration_ms: durationMs,
      degraded,
      run_id: state.runId,
      status: state.status,
      in_progress: state.inProgress
    });
    return json({
      run_id: state.runId,
      status: state.status,
      in_progress: state.inProgress,
      started_at: state.startedAt,
      completed_at: state.completedAt,
      last_run_status: state.lastRunStatus,
      last_error: state.lastError,
      stats: state.stats,
      refreshed_at: Date.now(),
      degraded
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Pull status unavailable';
    logWarn('pull.status.degraded', {
      request_id: locals.requestId,
      run_id: runId,
      error: message
    });
    return json({
      run_id: runId,
      status: null,
      in_progress: false,
      started_at: null,
      completed_at: null,
      last_run_status: null,
      last_error: message,
      stats: null,
      refreshed_at: Date.now(),
      degraded: true
    });
  }
};
