import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth';
import { nanoid } from 'nanoid';
import { dbAll, dbRun, now } from '$lib/server/db';

export const GET = async ({ platform, locals }) => {
  const feeds = await dbAll(
    locals.db,
    'SELECT id, url, title, site_url, last_polled_at, next_poll_at, error_count, disabled FROM feeds ORDER BY id ASC'
  );
  return json({ feeds });
};

export const POST = async ({ request, platform, locals }) => {
  requireAdmin(locals.user);
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
    locals.db,
    'INSERT INTO feeds (id, url, last_polled_at, next_poll_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING',
    [id, url, null, now()]
  );

  return json({ ok: true, id });
};
