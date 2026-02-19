import { nanoid } from 'nanoid';
import { dbGet, dbRun, now, type Db } from './db';
import { pollFeeds } from './ingest';
import { processJobs } from './jobs';
import { logError, logInfo, logWarn } from './log';

const PULL_RUN_STALE_MS = 1000 * 60 * 20;

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

export type PullRunStatus = 'queued' | 'running' | 'success' | 'failed';
export type PullRunLifecycleStatus = 'success' | 'failed' | null;

export type PullRunRecord = {
  id: string;
  status: PullRunStatus;
  trigger: string;
  cycles: number;
  started_at: number | null;
  completed_at: number | null;
  last_error: string | null;
  request_id: string | null;
  stats_json: string | null;
  created_at: number;
  updated_at: number;
};

export type ManualPullState = {
  runId: string | null;
  status: PullRunStatus | null;
  inProgress: boolean;
  startedAt: number | null;
  completedAt: number | null;
  lastRunStatus: PullRunLifecycleStatus;
  lastError: string | null;
  stats: PullStats | null;
};

const toLifecycleStatus = (status: PullRunStatus | null): PullRunLifecycleStatus => {
  if (status === 'success') return 'success';
  if (status === 'failed') return 'failed';
  return null;
};

const parseStats = (statsJson: string | null): PullStats | null => {
  if (!statsJson) return null;
  try {
    const parsed = JSON.parse(statsJson) as PullStats;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
};

const staleErrorMessage = `Pull run marked failed after ${Math.floor(PULL_RUN_STALE_MS / 60000)} minutes without progress heartbeat`;

export const recoverStalePullRuns = async (db: Db) => {
  const timestamp = now();
  const staleBefore = timestamp - PULL_RUN_STALE_MS;
  const result = await dbRun(
    db,
    `UPDATE pull_runs
     SET status = 'failed',
         completed_at = ?,
         last_error = ?,
         updated_at = ?
     WHERE status IN ('queued', 'running')
       AND updated_at < ?`,
    [timestamp, staleErrorMessage, timestamp, staleBefore]
  );
  const changed = Number(result.meta?.changes ?? 0);
  if (changed > 0) {
    logWarn('pull.stale_runs_recovered', { recovered: changed, stale_before: staleBefore });
  }
};

const touchPullRun = async (db: Db, runId: string) => {
  await dbRun(
    db,
    `UPDATE pull_runs
     SET updated_at = ?
     WHERE id = ?
       AND status = 'running'`,
    [now(), runId]
  );
};

export const getPullRun = async (db: Db, runId: string) =>
  dbGet<PullRunRecord>(
    db,
    `SELECT
      id,
      status,
      trigger,
      cycles,
      started_at,
      completed_at,
      last_error,
      request_id,
      stats_json,
      created_at,
      updated_at
    FROM pull_runs
    WHERE id = ?
    LIMIT 1`,
    [runId]
  );

export const getLatestPullRun = async (db: Db) =>
  dbGet<PullRunRecord>(
    db,
    `SELECT
      id,
      status,
      trigger,
      cycles,
      started_at,
      completed_at,
      last_error,
      request_id,
      stats_json,
      created_at,
      updated_at
    FROM pull_runs
    ORDER BY created_at DESC
    LIMIT 1`
  );

export const getActivePullRun = async (db: Db) =>
  dbGet<PullRunRecord>(
    db,
    `SELECT
      id,
      status,
      trigger,
      cycles,
      started_at,
      completed_at,
      last_error,
      request_id,
      stats_json,
      created_at,
      updated_at
    FROM pull_runs
    WHERE status IN ('queued', 'running')
    ORDER BY created_at DESC
    LIMIT 1`
  );

export const createPullRun = async (
  db: Db,
  input: { cycles: number; trigger: string; requestId?: string | null }
) => {
  const timestamp = now();
  const run: PullRunRecord = {
    id: nanoid(),
    status: 'queued',
    trigger: input.trigger,
    cycles: input.cycles,
    started_at: null,
    completed_at: null,
    last_error: null,
    request_id: input.requestId ?? null,
    stats_json: null,
    created_at: timestamp,
    updated_at: timestamp
  };

  await dbRun(
    db,
    `INSERT INTO pull_runs (
      id, status, trigger, cycles, started_at, completed_at, last_error, request_id, stats_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      run.id,
      run.status,
      run.trigger,
      run.cycles,
      run.started_at,
      run.completed_at,
      run.last_error,
      run.request_id,
      run.stats_json,
      run.created_at,
      run.updated_at
    ]
  );
  return run;
};

const markPullRunRunning = async (db: Db, runId: string) => {
  const timestamp = now();
  await dbRun(
    db,
    `UPDATE pull_runs
     SET status = 'running',
         started_at = COALESCE(started_at, ?),
         last_error = NULL,
         updated_at = ?
     WHERE id = ?
       AND status IN ('queued', 'running')`,
    [timestamp, timestamp, runId]
  );
};

const markPullRunFinished = async (
  db: Db,
  runId: string,
  input: { status: 'success' | 'failed'; stats?: PullStats | null; error?: string | null }
) => {
  const timestamp = now();
  await dbRun(
    db,
    `UPDATE pull_runs
     SET status = ?,
         completed_at = ?,
         last_error = ?,
         stats_json = ?,
         updated_at = ?
     WHERE id = ?`,
    [input.status, timestamp, input.error ?? null, input.stats ? JSON.stringify(input.stats) : null, timestamp, runId]
  );
};

export const getManualPullState = async (db: Db, runId?: string | null): Promise<ManualPullState> => {
  const run = (runId ? await getPullRun(db, runId) : null) ?? (await getLatestPullRun(db));
  if (!run) {
    return {
      runId: null,
      status: null,
      inProgress: false,
      startedAt: null,
      completedAt: null,
      lastRunStatus: null,
      lastError: null,
      stats: null
    };
  }

  return {
    runId: run.id,
    status: run.status,
    inProgress: run.status === 'queued' || run.status === 'running',
    startedAt: run.started_at ?? run.created_at ?? null,
    completedAt: run.completed_at ?? null,
    lastRunStatus: toLifecycleStatus(run.status),
    lastError: run.last_error,
    stats: parseStats(run.stats_json)
  };
};

export const startManualPull = async (
  db: Db,
  input: { cycles: number; trigger: string; requestId?: string | null }
) => {
  await recoverStalePullRuns(db);
  const active = await getActivePullRun(db);
  if (active) {
    return { started: false, runId: active.id } as const;
  }
  const run = await createPullRun(db, input);
  return { started: true, runId: run.id } as const;
};

export async function runPullRun(env: App.Platform['env'], runId: string): Promise<PullStats> {
  const db = env.DB;
  const run = await getPullRun(db, runId);
  if (!run) throw new Error('Pull run not found');

  await markPullRunRunning(db, runId);
  await touchPullRun(db, runId);
  logInfo('pull.run.started', { run_id: runId, cycles: run.cycles });
  let runError: string | null = null;
  let stats: PullStats | null = null;
  try {
    await dbRun(env.DB, 'UPDATE feeds SET next_poll_at = ? WHERE disabled = 0', [now()]);
    let dueFeeds = 0;
    let itemsSeen = 0;
    let itemsProcessed = 0;
    const recentErrors: { url: string; message: string }[] = [];

    for (let i = 0; i < run.cycles; i += 1) {
      const poll = await pollFeeds(env, {
        onFeedSettled: () => touchPullRun(db, runId)
      });
      dueFeeds += poll.dueFeeds;
      itemsSeen += poll.itemsSeen;
      itemsProcessed += poll.itemsProcessed;
      for (const err of poll.errors) {
        if (recentErrors.length >= 5) break;
        recentErrors.push({ url: err.url, message: err.message });
      }
      await touchPullRun(db, runId);
      await processJobs(env);
      await touchPullRun(db, runId);
    }

    const feeds = await dbGet<{ count: number }>(db, 'SELECT COUNT(*) as count FROM feeds');
    const articles = await dbGet<{ count: number }>(db, 'SELECT COUNT(*) as count FROM articles');
    const pendingJobs = await dbGet<{ count: number }>(db, "SELECT COUNT(*) as count FROM jobs WHERE status = 'pending'");
    const feedsWithErrors = await dbGet<{ count: number }>(db, 'SELECT COUNT(*) as count FROM feeds WHERE error_count > 0');

    stats = {
      feeds: feeds?.count ?? 0,
      articles: articles?.count ?? 0,
      pendingJobs: pendingJobs?.count ?? 0,
      feedsWithErrors: feedsWithErrors?.count ?? 0,
      dueFeeds,
      itemsSeen,
      itemsProcessed,
      recentErrors
    };

    await markPullRunFinished(db, runId, { status: 'success', stats });
    logInfo('pull.run.completed', { run_id: runId, status: 'success', stats });
    return stats;
  } catch (error) {
    runError = error instanceof Error ? error.message : 'Manual pull failed';
    await markPullRunFinished(db, runId, { status: 'failed', error: runError, stats });
    logError('pull.run.failed', { run_id: runId, status: 'failed', error: runError, stats });
    throw error;
  }
}

export async function runManualPull(
  env: App.Platform['env'],
  cycles: number,
  input?: { trigger?: string; requestId?: string | null }
) {
  const started = await startManualPull(env.DB, {
    cycles,
    trigger: input?.trigger ?? 'manual',
    requestId: input?.requestId
  });
  if (!started.started) {
    throw new Error('Manual pull already in progress');
  }

  const stats = await runPullRun(env, started.runId);
  return { runId: started.runId, stats };
}
