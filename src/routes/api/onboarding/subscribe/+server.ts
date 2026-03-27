import { json } from '@sveltejs/kit';
import { nanoid } from 'nanoid';
import { startManualPull } from '$lib/server/manual-pull';
import { dbGet, dbRun, now } from '$lib/server/db';

export const POST = async ({ request, platform, locals }) => {
  if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
  const db = platform.env.DB;

  const body = await request.json().catch(() => ({}));
  const feedUrls: string[] = body?.feedUrls ?? body?.feed_urls ?? [];
  if (!Array.isArray(feedUrls) || feedUrls.length === 0) {
    return json({ error: 'feedUrls is required' }, { status: 400 });
  }

  const timestamp = now();
  let subscribed = 0;

  for (const rawUrl of feedUrls) {
    const url = String(rawUrl).trim();
    if (!url) continue;
    try { new URL(url); } catch { continue; }

    await dbRun(db,
      'INSERT OR IGNORE INTO feeds (id, url, last_polled_at, next_poll_at) VALUES (?, ?, ?, ?)',
      [nanoid(), url, null, timestamp]
    );

    const feed = await dbGet<{ id: string }>(db, 'SELECT id FROM feeds WHERE url = ?', [url]);
    if (!feed) continue;

    await dbRun(db,
      'INSERT OR IGNORE INTO user_feed_subscriptions (id, user_id, feed_id, created_at) VALUES (?, ?, ?, ?)',
      [nanoid(), locals.user.id, feed.id, timestamp]
    );

    await dbRun(db, 'UPDATE feeds SET next_poll_at = ? WHERE id = ? AND (next_poll_at IS NULL OR next_poll_at > ?)', [timestamp, feed.id, timestamp]);
    subscribed++;
  }

  const pull = await startManualPull(db, { cycles: 1, trigger: 'onboarding', requestId: locals.requestId });

  return json({ ok: true, subscribed, runId: pull.runId });
};
