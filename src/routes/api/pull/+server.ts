import { getManualPullState, runPullRun, startManualPull } from '$lib/server/manual-pull';
import { recordAuditEvent } from '$lib/server/audit';
import { apiError, apiOkWithAliases } from '$lib/server/api';

export const GET = async (event) => {
  const { platform, url } = event;
  const runId = url.searchParams.get('run_id')?.trim() || null;
  const state = await getManualPullState(platform.env.DB, runId);
  const data = {
    run_id: state.runId,
    status: state.status,
    in_progress: state.inProgress,
    started_at: state.startedAt,
    completed_at: state.completedAt,
    last_run_status: state.lastRunStatus,
    last_error: state.lastError,
    stats: state.stats
  };
  return apiOkWithAliases(event, data, {
    run_id: data.run_id,
    status: data.status,
    inProgress: state.inProgress,
    startedAt: state.startedAt,
    completedAt: state.completedAt,
    lastRunStatus: state.lastRunStatus,
    lastError: state.lastError,
    stats: state.stats
  });
};

export const POST = async (event) => {
  const { request, platform, locals } = event;
  const body = await request.json().catch(() => ({}));
  const requestedCycles = Number(body?.cycles ?? 1);
  const cycles = Number.isFinite(requestedCycles)
    ? Math.max(1, Math.min(10, Math.floor(requestedCycles)))
    : 1;

  try {
    const started = await startManualPull(platform.env.DB, {
      cycles,
      trigger: 'api',
      requestId: locals.requestId
    });
    if (!started.started) {
      return apiError(event, 409, 'conflict', 'Manual pull already in progress', {
        run_id: started.runId
      });
    }

    await recordAuditEvent(platform.env.DB, {
      actor: 'admin',
      action: 'pull.trigger',
      target: started.runId,
      requestId: locals.requestId,
      metadata: { cycles }
    });

    const runPromise = runPullRun(platform.env, started.runId);
    platform.context.waitUntil(
      runPromise.catch((error) => {
        console.error('Background manual pull failed', error);
      })
    );

    return apiOkWithAliases(
      event,
      {
        cycles,
        started: true,
        run_id: started.runId
      },
      {
        cycles,
        started: true,
        run_id: started.runId
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Manual pull failed';
    if (message.includes('already in progress')) {
      return apiError(event, 409, 'conflict', message);
    }
    return apiError(event, 500, 'internal_error', message);
  }
};
