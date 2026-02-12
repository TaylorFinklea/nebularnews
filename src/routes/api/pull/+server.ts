import { json } from '@sveltejs/kit';
import { runManualPull } from '$lib/server/manual-pull';

export const POST = async ({ request, platform }) => {
  const body = await request.json().catch(() => ({}));
  const requestedCycles = Number(body?.cycles ?? 1);
  const cycles = Number.isFinite(requestedCycles)
    ? Math.max(1, Math.min(10, Math.floor(requestedCycles)))
    : 1;

  try {
    const stats = await runManualPull(platform.env, cycles);
    return json({ ok: true, cycles, stats });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Manual pull failed';
    if (message.includes('already in progress')) {
      return json({ error: message }, { status: 409 });
    }
    return json({ error: message }, { status: 500 });
  }
};
