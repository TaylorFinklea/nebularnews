import { dev } from '$app/environment';
import { json } from '@sveltejs/kit';
import { runManualPull } from '$lib/server/manual-pull';

export const POST = async ({ request, platform }) => {
  if (!dev) {
    return json({ error: 'Manual pull endpoint is only available in dev mode' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const requestedCycles = Number(body?.cycles ?? 3);
  const cycles = Number.isFinite(requestedCycles)
    ? Math.max(1, Math.min(10, Math.floor(requestedCycles)))
    : 3;

  try {
    const result = await runManualPull(platform.env, cycles, { trigger: 'api-dev' });
    return json({ ok: true, cycles, run_id: result.runId, stats: result.stats });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Manual pull failed';
    if (message.includes('already in progress')) {
      return json({ error: message }, { status: 409 });
    }
    return json({ error: message }, { status: 500 });
  }
};
