import { json } from '@sveltejs/kit';
import { dbRun, now } from '$lib/server/db';
import { requireMobileAccess } from '$lib/server/mobile/auth';

export const POST = async ({ params, request, locals }) => {
  const { user } = await requireMobileAccess(request, locals.env, locals.db, 'app:write');

  const body = await request.json().catch(() => ({}));
  const saved = body?.saved !== false;
  const mutatedAt = now();
  const savedAt = saved ? mutatedAt : null;

  await dbRun(
    locals.db,
    `INSERT INTO article_read_state (user_id, article_id, is_read, updated_at, saved_at)
     VALUES (?, ?, 0, ?, ?)
     ON CONFLICT(user_id, article_id) DO UPDATE SET
       saved_at = excluded.saved_at,
       updated_at = excluded.updated_at`,
    [user.id, params.id, mutatedAt, savedAt]
  );

  return json({
    articleId: params.id,
    saved,
    savedAt
  });
};
