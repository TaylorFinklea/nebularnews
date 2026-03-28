import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth';
import { dbRun, getAffectedRows } from '$lib/server/db';

export const POST = async ({ platform, locals }) => {
  requireAdmin(locals.user);
  const result = await dbRun(
    locals.db,
    'UPDATE feeds SET next_poll_at = NULL, error_count = 0 WHERE disabled = 0'
  );
  const count = getAffectedRows(result);
  return json({ ok: true, resetCount: count });
};
