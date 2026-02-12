import { json } from '@sveltejs/kit';
import { nanoid } from 'nanoid';
import { dbRun, now } from '$lib/server/db';
import { getPreferredSourceForArticle, isFeedLinkedToArticle } from '$lib/server/sources';

export const POST = async ({ params, request, platform }) => {
  const { id } = params;
  const body = await request.json();
  const rating = Number(body?.rating);
  const feedIdInput = typeof body?.feedId === 'string' ? body.feedId.trim() : '';
  const comment = body?.comment?.trim() ?? null;
  if (!rating || rating < 1 || rating > 5) return json({ error: 'Invalid rating' }, { status: 400 });

  let feedId: string | null = null;
  if (feedIdInput && (await isFeedLinkedToArticle(platform.env.DB, id, feedIdInput))) {
    feedId = feedIdInput;
  } else {
    feedId = (await getPreferredSourceForArticle(platform.env.DB, id))?.feedId ?? null;
  }

  await dbRun(
    platform.env.DB,
    'INSERT INTO article_feedback (id, article_id, feed_id, rating, comment, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [nanoid(), id, feedId, rating, comment, now()]
  );

  await dbRun(
    platform.env.DB,
    `INSERT INTO jobs (id, type, article_id, status, attempts, run_after, last_error)
     VALUES (?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(type, article_id) DO UPDATE SET
       status = excluded.status,
       attempts = 0,
       run_after = excluded.run_after,
       last_error = NULL`,
    [nanoid(), 'refresh_profile', 'profile', 'pending', 0, now()]
  );

  return json({ ok: true, feedId });
};
