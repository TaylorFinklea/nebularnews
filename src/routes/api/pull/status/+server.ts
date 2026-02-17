import { json } from '@sveltejs/kit';
import { getManualPullState } from '$lib/server/manual-pull';

export const GET = async ({ platform, url }) => {
  const runId = url.searchParams.get('run_id')?.trim() || null;
  const state = await getManualPullState(platform.env.DB, runId);
  return json({
    run_id: state.runId,
    status: state.status,
    in_progress: state.inProgress,
    started_at: state.startedAt,
    completed_at: state.completedAt,
    last_run_status: state.lastRunStatus,
    last_error: state.lastError,
    stats: state.stats
  });
};

