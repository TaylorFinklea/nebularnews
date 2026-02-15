import { json } from '@sveltejs/kit';
import { getManualPullState, runManualPull } from '$lib/server/manual-pull';

export const GET = async ({ platform }) => {
  const state = await getManualPullState(platform.env.DB);
  return json({
    inProgress: state.inProgress,
    startedAt: state.startedAt,
    completedAt: state.completedAt,
    lastRunStatus: state.lastRunStatus,
    lastError: state.lastError
  });
};

export const POST = async ({ request, platform }) => {
  const body = await request.json().catch(() => ({}));
  const requestedCycles = Number(body?.cycles ?? 1);
  const cycles = Number.isFinite(requestedCycles)
    ? Math.max(1, Math.min(10, Math.floor(requestedCycles)))
    : 1;

  try {
    const state = await getManualPullState(platform.env.DB);
    if (state.inProgress) {
      return json({ error: 'Manual pull already in progress' }, { status: 409 });
    }

    // Keep the pull running even if the user navigates away or refreshes.
    const runPromise = runManualPull(platform.env, cycles);
    platform.context.waitUntil(
      runPromise.catch((error) => {
        console.error('Background manual pull failed', error);
      })
    );

    return json({ ok: true, cycles, started: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Manual pull failed';
    if (message.includes('already in progress')) {
      return json({ error: message }, { status: 409 });
    }
    return json({ error: message }, { status: 500 });
  }
};
