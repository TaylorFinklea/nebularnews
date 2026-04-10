import type { Env } from '../env';
import { dbRun } from '../db/helpers';

export async function cleanup(env: Env): Promise<void> {
  const db = env.DB;
  const now = Date.now();
  const ninetyDaysAgo = now - 90 * 24 * 60 * 60 * 1000;
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

  // 1. Delete orphan articles older than 90 days (no subscribed feeds)
  await dbRun(db,
    `DELETE FROM articles
     WHERE created_at < ?
       AND id NOT IN (
         SELECT DISTINCT asrc.article_id
         FROM article_sources asrc
         JOIN user_feed_subscriptions ufs ON ufs.feed_id = asrc.feed_id
       )`,
    [ninetyDaysAgo],
  );

  // 2. Delete expired sessions (better-auth session table)
  await dbRun(db,
    `DELETE FROM session WHERE expiresAt < ?`,
    [now],
  );

  // 3. Delete completed jobs older than 7 days
  await dbRun(db,
    `DELETE FROM jobs WHERE status = 'completed' AND completed_at < ?`,
    [sevenDaysAgo],
  );

  // 4. Delete old pull_runs older than 30 days
  await dbRun(db,
    `DELETE FROM pull_runs WHERE created_at < ?`,
    [thirtyDaysAgo],
  );
}
