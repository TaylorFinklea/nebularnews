import { dbAll } from '$lib/server/db';

export const load = async ({ platform }) => {
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
      COALESCE((SELECT COUNT(*) FROM article_reactions ar WHERE ar.feed_id = f.id), 0) as feedback_count,
      COALESCE((SELECT SUM(ar.value) * 1.0 / (COUNT(*) + 5.0) FROM article_reactions ar WHERE ar.feed_id = f.id), 0) as reputation
    FROM feeds f
    ORDER BY COALESCE(f.title, f.url) ASC`
  );
  return { feeds };
};
