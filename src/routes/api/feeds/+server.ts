import { json } from '@sveltejs/kit';
import { nanoid } from 'nanoid';
import { dbAll, dbRun, now } from '$lib/server/db';

export const GET = async ({ platform }) => {
  const feeds = await dbAll(
    platform.env.DB,
    'SELECT id, url, title, site_url, last_polled_at, next_poll_at, error_count, disabled FROM feeds ORDER BY id ASC'
  );
  return json({ feeds });
};

export const POST = async ({ request, platform }) => {
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
