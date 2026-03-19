import { json } from '@sveltejs/kit';
import { nanoid } from 'nanoid';
import { dbAll, dbRun, now } from '$lib/server/db';
import { requireMobileAccess } from '$lib/server/mobile/auth';

export const GET = async ({ request, platform }) => {
  await requireMobileAccess(request, platform.env, platform.env.DB, 'app:read');

  const feeds = await dbAll(
    platform.env.DB,
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
     ORDER BY COALESCE(NULLIF(f.title, ''), f.url) COLLATE NOCASE ASC`
  );

  return json({ feeds });
};

export const POST = async ({ request, platform }) => {
  await requireMobileAccess(request, platform.env, platform.env.DB, 'app:write');

  const body = await request.json();
  const url = body?.url?.trim();
  if (!url) return json({ error: 'Missing url' }, { status: 400 });

  try {
    new URL(url);
  } catch {
    return json({ error: 'Invalid url' }, { status: 400 });
  }

  const id = nanoid();
  await dbRun(
    platform.env.DB,
    'INSERT OR IGNORE INTO feeds (id, url, last_polled_at, next_poll_at) VALUES (?, ?, ?, ?)',
    [id, url, null, now()]
  );

  return json({ ok: true, id });
};
