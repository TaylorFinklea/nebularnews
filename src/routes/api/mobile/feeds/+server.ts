import { json } from '@sveltejs/kit';
import { nanoid } from 'nanoid';
import { dbAll, dbRun, now } from '$lib/server/db';
import { requireMobileAccess } from '$lib/server/mobile/auth';

export const GET = async ({ request, locals }) => {
  const { user } = await requireMobileAccess(request, locals.env, locals.db, 'app:read');

  const feeds = await dbAll(
    locals.db,
    `SELECT
      f.id,
      f.url,
      f.title,
      f.site_url,
      f.last_polled_at,
      f.next_poll_at,
      f.error_count,
      f.disabled,
      (
        SELECT COUNT(*)
        FROM article_sources src
        WHERE src.feed_id = f.id
      ) as article_count
     FROM feeds f
     WHERE EXISTS (
       SELECT 1 FROM user_feed_subscriptions ufs
       WHERE ufs.feed_id = f.id AND ufs.user_id = ?
     )
     ORDER BY LOWER(COALESCE(NULLIF(f.title, ''), f.url)) ASC`,
    [user.id]
  );

  return json({ feeds });
};

export const POST = async ({ request, locals }) => {
  const { user } = await requireMobileAccess(request, locals.env, locals.db, 'app:write');

  const body = await request.json();
  const url = body?.url?.trim();
  if (!url) return json({ error: 'Missing url' }, { status: 400 });

  try {
    new URL(url);
  } catch {
    return json({ error: 'Invalid url' }, { status: 400 });
  }

  const id = nanoid();
  const timestamp = now();
  await dbRun(
    locals.db,
    'INSERT INTO feeds (id, url, last_polled_at, next_poll_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING',
    [id, url, null, timestamp]
  );
  await dbRun(
    locals.db,
    `INSERT INTO user_feed_subscriptions (id, user_id, feed_id, created_at)
     VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING`,
    [nanoid(), user.id, id, timestamp]
  );

  return json({ ok: true, id });
};
