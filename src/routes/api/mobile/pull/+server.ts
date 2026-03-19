import { json } from '@sveltejs/kit';
import { startManualPull } from '$lib/server/manual-pull';
import { requireMobileAccess } from '$lib/server/mobile/auth';

export const POST = async ({ request, platform }) => {
  await requireMobileAccess(request, platform.env, platform.env.DB, 'app:write');

  const body = await request.json().catch(() => ({}));
  const requestedCycles = Number(body?.cycles ?? 1);
  const cycles = Number.isFinite(requestedCycles)
    ? Math.max(1, Math.min(10, Math.floor(requestedCycles)))
    : 1;

  const result = await startManualPull(platform.env.DB, {
    cycles,
    trigger: 'mobile',
    requestId: null
  });

  if (!result.started) {
    return json(
      { error: 'Manual pull already in progress', runId: result.runId },
      { status: 409 }
    );
  }

  return json({ ok: true, started: true, runId: result.runId });
};
