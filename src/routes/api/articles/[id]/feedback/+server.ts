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

  const timestamp = now();
  await dbRun(
    platform.env.DB,
    `INSERT INTO article_score_overrides (article_id, score, comment, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(article_id) DO UPDATE SET
       score = excluded.score,
       comment = excluded.comment,
       updated_at = excluded.updated_at`,
    [id, rating, comment, timestamp, timestamp]
  );

  await dbRun(
    platform.env.DB,
    `INSERT INTO jobs (id, type, article_id, status, attempts, priority, run_after, last_error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
     ON CONFLICT(type, article_id) DO UPDATE SET
       status = excluded.status,
       attempts = 0,
       priority = excluded.priority,
       run_after = excluded.run_after,
       last_error = NULL,
       provider = NULL,
       model = NULL,
       locked_by = NULL,
       locked_at = NULL,
       lease_expires_at = NULL,
       updated_at = excluded.updated_at`,
    [nanoid(), 'refresh_profile', 'profile', 'pending', 0, 100, now(), now(), now()]
  );

  return json({ ok: true, feedId });
};
