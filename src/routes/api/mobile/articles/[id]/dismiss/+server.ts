import { json } from '@sveltejs/kit';
import { dbRun, now } from '$lib/server/db';
import { requireMobileAccess } from '$lib/server/mobile/auth';

export const POST = async ({ params, request, platform }) => {
  await requireMobileAccess(request, platform.env, platform.env.DB, 'app:write');

  const mutatedAt = now();

  await dbRun(
    platform.env.DB,
    `INSERT INTO article_read_state (article_id, is_read, updated_at)
     VALUES (?, 1, ?)
     ON CONFLICT(article_id) DO UPDATE SET
       is_read = 1,
       updated_at = excluded.updated_at`,
    [params.id, mutatedAt]
  );

  return json({
    articleId: params.id,
    dismissed: true,
    mutatedAt
  });
};
