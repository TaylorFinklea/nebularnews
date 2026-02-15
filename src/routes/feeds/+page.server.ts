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
  const lowestRatedFeeds = await dbAll(
    platform.env.DB,
    `SELECT
      f.id,
      f.url,
      f.title,
      COUNT(ar.id) as feedback_count,
      COALESCE(SUM(ar.value) * 1.0 / (COUNT(ar.id) + 5.0), 0) as reputation
    FROM feeds f
    JOIN article_reactions ar ON ar.feed_id = f.id
    GROUP BY f.id, f.url, f.title
    HAVING COUNT(ar.id) > 0
    ORDER BY reputation ASC, feedback_count DESC, COALESCE(f.title, f.url) COLLATE NOCASE ASC
    LIMIT 20`
  );
  return { feeds, lowestRatedFeeds };
};
