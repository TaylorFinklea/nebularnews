import { json } from '@sveltejs/kit';
import { dbRun, now } from '$lib/server/db';
import { requireMobileAccess } from '$lib/server/mobile/auth';

export const POST = async ({ params, request, platform }) => {
  await requireMobileAccess(request, platform.env, platform.env.DB, 'app:write');

  const body = await request.json().catch(() => ({}));
  const isRead = Boolean(body?.isRead ?? body?.is_read);
  const mutatedAt = now();

  await dbRun(
    platform.env.DB,
    `INSERT INTO article_read_state (article_id, is_read, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(article_id) DO UPDATE SET
       is_read = excluded.is_read,
       updated_at = excluded.updated_at`,
    [params.id, isRead ? 1 : 0, mutatedAt]
  );

  return json({
    article_id: params.id,
    is_read: isRead ? 1 : 0,
    mutated_at: mutatedAt
  });
};
