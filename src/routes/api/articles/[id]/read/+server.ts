import { dbRun, now } from '$lib/server/db';
import { apiOkWithAliases } from '$lib/server/api';
import { logInfo } from '$lib/server/log';

export const POST = async (event) => {
  const { params, request, platform } = event;
  const articleId = params.id;
  const body = await request.json().catch(() => ({}));
  const isRead = Boolean(body?.isRead);
  const mutatedAt = now();

  await dbRun(
    platform.env.DB,
    `INSERT INTO article_read_state (article_id, is_read, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(article_id) DO UPDATE SET
       is_read = excluded.is_read,
       updated_at = excluded.updated_at`,
    [articleId, isRead ? 1 : 0, mutatedAt]
  );

  logInfo('article.read.updated', {
    request_id: event.locals.requestId,
    article_id: articleId,
    is_read: isRead ? 1 : 0
  });

  const data = {
    article_id: articleId,
    is_read: isRead ? 1 : 0,
    mutated_at: mutatedAt
  };
  return apiOkWithAliases(event, data, {
    articleId,
    isRead
  });
};
