import { json } from '@sveltejs/kit';
import { dbRun, getAffectedRows } from '$lib/server/db';

export const POST = async ({ platform }) => {
  const result = await dbRun(
    platform.env.DB,
    'UPDATE feeds SET next_poll_at = NULL, error_count = 0 WHERE disabled = 0'
  );
  const count = getAffectedRows(result);
  return json({ ok: true, resetCount: count });
};
