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
      COALESCE((SELECT COUNT(*) FROM article_feedback af WHERE af.feed_id = f.id), 0) as feedback_count,
      COALESCE((SELECT (SUM(af.rating) - 3.0 * COUNT(*)) / (COUNT(*) + 5.0) FROM article_feedback af WHERE af.feed_id = f.id), 0) as reputation
    FROM feeds f
    ORDER BY COALESCE(f.title, f.url) ASC`
  );
  return { feeds };
};
