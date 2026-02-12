import { json } from '@sveltejs/kit';
import { nanoid } from 'nanoid';
import { dbRun, now } from '$lib/server/db';
import { getPreferredSourceForArticle, isFeedLinkedToArticle } from '$lib/server/sources';

export const POST = async ({ params, request, platform }) => {
  const articleId = params.id;
  const body = await request.json().catch(() => ({}));
  const value = Number(body?.value);
  const feedIdInput = typeof body?.feedId === 'string' ? body.feedId.trim() : '';

  if (![1, -1].includes(value)) {
    return json({ error: 'Invalid value' }, { status: 400 });
  }

  let feedId: string | null = null;
  if (feedIdInput && (await isFeedLinkedToArticle(platform.env.DB, articleId, feedIdInput))) {
    feedId = feedIdInput;
  } else {
    feedId = (await getPreferredSourceForArticle(platform.env.DB, articleId))?.feedId ?? null;
  }

  if (!feedId) {
    return json({ error: 'No source feed found for article' }, { status: 400 });
  }

  const timestamp = now();
  await dbRun(
    platform.env.DB,
    `INSERT INTO article_reactions (id, article_id, feed_id, value, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(article_id) DO UPDATE SET
       feed_id = excluded.feed_id,
       value = excluded.value,
       created_at = excluded.created_at`,
    [nanoid(), articleId, feedId, value, timestamp]
  );

  return json({ ok: true, reaction: { articleId, feedId, value, createdAt: timestamp } });
};
