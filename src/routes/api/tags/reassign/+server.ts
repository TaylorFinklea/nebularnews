import { json } from '@sveltejs/kit';
import { reassignTagUsage } from '$lib/server/tags';

export const POST = async ({ request, platform }) => {
  const body = await request.json().catch(() => ({}));
  const fromTagId = typeof body?.fromTagId === 'string' ? body.fromTagId.trim() : '';
  const toTagId = typeof body?.toTagId === 'string' ? body.toTagId.trim() : '';
  const keepFrom = body?.keepFrom === true;

  if (!fromTagId || !toTagId) {
    return json({ error: 'fromTagId and toTagId are required' }, { status: 400 });
  }
  if (fromTagId === toTagId) {
    return json({ error: 'fromTagId and toTagId must differ' }, { status: 400 });
  }

  try {
    const result = await reassignTagUsage(platform.env.DB, { fromTagId, toTagId, keepFrom });
    return json({ ok: true, result });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Reassign failed' }, { status: 400 });
  }
};
