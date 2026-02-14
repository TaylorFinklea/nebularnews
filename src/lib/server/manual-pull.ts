import { nanoid } from 'nanoid';
import { dbGet, dbRun, now, type Db } from './db';
import { pollFeeds } from './ingest';
import { processJobs } from './jobs';

let pullInProgress = false;
let pullStartedAt: number | null = null;
let pullCompletedAt: number | null = null;
const MANUAL_PULL_STATE_KEY = 'manual_pull_state';
const STALE_PULL_MS = 30 * 60 * 1000;

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

export type ManualPullState = {
  inProgress: boolean;
  startedAt: number | null;
  completedAt: number | null;
};

const parseManualPullState = (raw: string | null): ManualPullState => {
  if (!raw) return { inProgress: false, startedAt: null, completedAt: null };
  try {
    const parsed = JSON.parse(raw) as {
      inProgress?: boolean;
      startedAt?: number | null;
      completedAt?: number | null;
    };
    return {
      inProgress: Boolean(parsed?.inProgress),
      startedAt: typeof parsed?.startedAt === 'number' ? parsed.startedAt : null,
      completedAt: typeof parsed?.completedAt === 'number' ? parsed.completedAt : null
    };
  } catch {
    return { inProgress: false, startedAt: null, completedAt: null };
  }
};

const writeManualPullState = async (db: Db, state: ManualPullState) => {
  const timestamp = now();
  await dbRun(
    db,
    `INSERT INTO settings (id, key, value, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_at = excluded.updated_at`,
    [nanoid(), MANUAL_PULL_STATE_KEY, JSON.stringify(state), timestamp]
  );
};

export async function getManualPullState(db: Db): Promise<ManualPullState> {
  const row = await dbGet<{ value: string }>(db, 'SELECT value FROM settings WHERE key = ?', [MANUAL_PULL_STATE_KEY]);
  const persisted = parseManualPullState(row?.value ?? null);
  if (
    persisted.inProgress &&
    typeof persisted.startedAt === 'number' &&
    Date.now() - persisted.startedAt >= STALE_PULL_MS
  ) {
    const resetState: ManualPullState = {
      inProgress: false,
      startedAt: null,
      completedAt: persisted.completedAt
    };
    await writeManualPullState(db, resetState);
    return resetState;
  }
  if (pullInProgress) {
    return {
      inProgress: true,
      startedAt: pullStartedAt,
      completedAt: pullCompletedAt
    };
  }
  return persisted;
}

export async function runManualPull(env: App.Platform['env'], cycles: number): Promise<PullStats> {
  const persisted = await getManualPullState(env.DB);
  if (
    persisted.inProgress &&
    typeof persisted.startedAt === 'number' &&
    Date.now() - persisted.startedAt < STALE_PULL_MS
  ) {
    throw new Error('Manual pull already in progress');
  }

  if (pullInProgress) {
    throw new Error('Manual pull already in progress');
  }

  pullInProgress = true;
  pullStartedAt = Date.now();
  pullCompletedAt = null;
  await writeManualPullState(env.DB, {
    inProgress: true,
    startedAt: pullStartedAt,
    completedAt: persisted.completedAt
  });
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
    pullCompletedAt = Date.now();
    pullStartedAt = null;
    await writeManualPullState(env.DB, {
      inProgress: false,
      startedAt: null,
      completedAt: pullCompletedAt
    });
  }
}
