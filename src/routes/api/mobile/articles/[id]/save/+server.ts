import { json } from '@sveltejs/kit';
import { dbRun, now } from '$lib/server/db';
import { requireMobileAccess } from '$lib/server/mobile/auth';

export const POST = async ({ params, request, platform }) => {
  await requireMobileAccess(request, platform.env, platform.env.DB, 'app:write');

  const body = await request.json().catch(() => ({}));
  const saved = body?.saved !== false;
  const mutatedAt = now();
  const savedAt = saved ? mutatedAt : null;

  await dbRun(
    platform.env.DB,
    `INSERT INTO article_read_state (article_id, is_read, updated_at, saved_at)
     VALUES (?, 0, ?, ?)
     ON CONFLICT(article_id) DO UPDATE SET
       saved_at = excluded.saved_at,
       updated_at = excluded.updated_at`,
    [params.id, mutatedAt, savedAt]
  );

  return json({
    articleId: params.id,
    saved,
    savedAt
  });
};
