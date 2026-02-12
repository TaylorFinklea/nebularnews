import { dbGet, dbRun, now } from './db';
import { pollFeeds } from './ingest';
import { processJobs } from './jobs';

let pullInProgress = false;

export type PullStats = {
  feeds: number;
  articles: number;
  pendingJobs: number;
  feedsWithErrors: number;
  dueFeeds: number;
  itemsSeen: number;
  itemsProcessed: number;
  recentErrors: { url: string; message: string }[];
};

export async function runManualPull(env: App.Platform['env'], cycles: number): Promise<PullStats> {
  if (pullInProgress) {
    throw new Error('Manual pull already in progress');
  }

  pullInProgress = true;
  try {
    // Manual pulls should bypass polling backoff windows and retry immediately.
    await dbRun(env.DB, 'UPDATE feeds SET next_poll_at = ? WHERE disabled = 0', [now()]);
    let dueFeeds = 0;
    let itemsSeen = 0;
    let itemsProcessed = 0;
    const recentErrors: { url: string; message: string }[] = [];

    for (let i = 0; i < cycles; i += 1) {
      const poll = await pollFeeds(env);
      dueFeeds += poll.dueFeeds;
      itemsSeen += poll.itemsSeen;
      itemsProcessed += poll.itemsProcessed;
      for (const err of poll.errors) {
        if (recentErrors.length >= 5) break;
        recentErrors.push({ url: err.url, message: err.message });
      }
      await processJobs(env);
    }

    const db = env.DB;
    const feeds = await dbGet<{ count: number }>(db, 'SELECT COUNT(*) as count FROM feeds');
    const articles = await dbGet<{ count: number }>(db, 'SELECT COUNT(*) as count FROM articles');
    const pendingJobs = await dbGet<{ count: number }>(
      db,
      "SELECT COUNT(*) as count FROM jobs WHERE status = 'pending'"
    );
    const feedsWithErrors = await dbGet<{ count: number }>(
      db,
      'SELECT COUNT(*) as count FROM feeds WHERE error_count > 0'
    );

    return {
      feeds: feeds?.count ?? 0,
      articles: articles?.count ?? 0,
      pendingJobs: pendingJobs?.count ?? 0,
      feedsWithErrors: feedsWithErrors?.count ?? 0,
      dueFeeds,
      itemsSeen,
      itemsProcessed,
      recentErrors
    };
  } finally {
    pullInProgress = false;
  }
}
