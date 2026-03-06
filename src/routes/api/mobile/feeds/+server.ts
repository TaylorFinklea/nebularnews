import { json } from '@sveltejs/kit';
import { dbAll } from '$lib/server/db';
import { requireMobileAccess } from '$lib/server/mobile/auth';

export const GET = async ({ request, platform }) => {
  await requireMobileAccess(request, platform.env, platform.env.DB, 'app:read');

  const feeds = await dbAll(
    platform.env.DB,
    `SELECT
      f.id,
      f.url,
      f.title,
      f.site_url,
      f.last_polled_at,
      f.next_poll_at,
      f.error_count,
      f.disabled,
      (
        SELECT COUNT(*)
        FROM article_sources src
        WHERE src.feed_id = f.id
      ) as article_count
     FROM feeds f
     ORDER BY COALESCE(NULLIF(f.title, ''), f.url) COLLATE NOCASE ASC`
  );

  return json({ feeds });
};
