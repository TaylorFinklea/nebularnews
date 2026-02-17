import { json } from '@sveltejs/kit';
import { getManualPullState, runPullRun, startManualPull } from '$lib/server/manual-pull';
import { recordAuditEvent } from '$lib/server/audit';

export const GET = async ({ platform, url }) => {
  const runId = url.searchParams.get('run_id')?.trim() || null;
  const state = await getManualPullState(platform.env.DB, runId);
  return json({
    run_id: state.runId,
    status: state.status,
    inProgress: state.inProgress,
    startedAt: state.startedAt,
    completedAt: state.completedAt,
    lastRunStatus: state.lastRunStatus,
    lastError: state.lastError,
    stats: state.stats
  });
};

export const POST = async ({ request, platform, locals }) => {
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
      return json(
        {
          error: 'Manual pull already in progress',
          run_id: started.runId
        },
        { status: 409 }
      );
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

    return json({ ok: true, cycles, started: true, run_id: started.runId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Manual pull failed';
    if (message.includes('already in progress')) {
      return json({ error: message }, { status: 409 });
    }
    return json({ error: message }, { status: 500 });
  }
};
