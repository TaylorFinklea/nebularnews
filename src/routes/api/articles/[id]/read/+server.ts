import { json } from '@sveltejs/kit';
import { dbRun, now } from '$lib/server/db';

export const POST = async ({ params, request, platform }) => {
  const articleId = params.id;
  const body = await request.json().catch(() => ({}));
  const isRead = Boolean(body?.isRead);

  await dbRun(
    platform.env.DB,
    `INSERT INTO article_read_state (article_id, is_read, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(article_id) DO UPDATE SET
       is_read = excluded.is_read,
       updated_at = excluded.updated_at`,
    [articleId, isRead ? 1 : 0, now()]
  );

  return json({ ok: true, articleId, isRead });
};
