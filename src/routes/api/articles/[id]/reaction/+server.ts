import { nanoid } from 'nanoid';
import { dbRun, now } from '$lib/server/db';
import { getPreferredSourceForArticle, isFeedLinkedToArticle } from '$lib/server/sources';
import { apiError, apiOkWithAliases } from '$lib/server/api';
import { logInfo } from '$lib/server/log';

export const POST = async (event) => {
  const { params, request, platform } = event;
  const articleId = params.id;
  const body = await request.json().catch(() => ({}));
  const value = Number(body?.value);
  const feedIdInput = typeof body?.feedId === 'string' ? body.feedId.trim() : '';

  if (![1, -1].includes(value)) {
    return apiError(event, 400, 'validation_error', 'Invalid reaction value');
  }

  let feedId: string | null = null;
  if (feedIdInput && (await isFeedLinkedToArticle(platform.env.DB, articleId, feedIdInput))) {
    feedId = feedIdInput;
  } else {
    feedId = (await getPreferredSourceForArticle(platform.env.DB, articleId))?.feedId ?? null;
  }

  if (!feedId) {
    return apiError(event, 400, 'bad_request', 'No source feed found for article');
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

  logInfo('article.reaction.updated', {
    request_id: event.locals.requestId,
    article_id: articleId,
    feed_id: feedId,
    value
  });

  const reaction = {
    article_id: articleId,
    feed_id: feedId,
    value,
    created_at: timestamp
  };

  return apiOkWithAliases(
    event,
    {
      reaction
    },
    {
      reaction: {
        articleId,
        feedId,
        value,
        createdAt: timestamp
      }
    }
  );
};
