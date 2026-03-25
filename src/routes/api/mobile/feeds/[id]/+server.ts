import { json } from '@sveltejs/kit';
import { dbGet, dbRun } from '$lib/server/db';
import { requireMobileAccess } from '$lib/server/mobile/auth';

export const DELETE = async ({ request, params, platform }) => {
  const { user } = await requireMobileAccess(request, platform.env, platform.env.DB, 'app:write');

  const { id } = params;
  const feed = await dbGet<{ id: string }>(
    platform.env.DB,
    'SELECT id FROM feeds WHERE id = ?',
    [id]
  );
  if (!feed) return json({ error: 'Feed not found' }, { status: 404 });

  await dbRun(
    platform.env.DB,
    'DELETE FROM user_feed_subscriptions WHERE user_id = ? AND feed_id = ?',
    [user.id, id]
  );

  return json({ ok: true, unsubscribed: true });
};
