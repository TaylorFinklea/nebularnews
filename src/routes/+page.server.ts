import { dev } from '$app/environment';
import { dbGet } from '$lib/server/db';

export const load = async ({ platform }) => {
  const db = platform.env.DB;
  const feeds = await dbGet<{ count: number }>(db, 'SELECT COUNT(*) as count FROM feeds');
  const articles = await dbGet<{ count: number }>(db, 'SELECT COUNT(*) as count FROM articles');
  const pendingJobs = await dbGet<{ count: number }>(
    db,
    "SELECT COUNT(*) as count FROM jobs WHERE status = 'pending'"
  );

  return {
    isDev: dev,
    stats: {
      feeds: feeds?.count ?? 0,
      articles: articles?.count ?? 0,
      pendingJobs: pendingJobs?.count ?? 0
    }
  };
};
