import { dbAll, dbGet, now, type Db } from './db';

const PULL_STALE_WARN_MS = 1000 * 60 * 90;
const PENDING_JOBS_WARN_THRESHOLD = 500;
const FEEDS_ERROR_WARN_THRESHOLD = 10;
const ARTICLE_ROWS_WARN_THRESHOLD = 100_000;

export type OpsSummary = {
  timestamp: number;
  feeds: {
    total: number;
    disabled: number;
    due: number;
    with_errors: number;
  };
  jobs: {
    pending: number;
    running: number;
    failed: number;
    done: number;
    cancelled: number;
  };
  pull: {
    latest_run_id: string | null;
    latest_status: string | null;
    latest_started_at: number | null;
    latest_completed_at: number | null;
    latest_error: string | null;
    success_24h: number;
    failed_24h: number;
  };
  data_volume: {
    articles: number;
    summaries: number;
    scores: number;
    chat_messages: number;
  };
  warnings: string[];
};

const getCount = async (db: Db, sql: string, params: unknown[] = []) => {
  const row = await dbGet<{ count: number }>(db, sql, params);
  return row?.count ?? 0;
};

export async function getOpsSummary(db: Db): Promise<OpsSummary> {
  const timestamp = now();
  const since24h = timestamp - 24 * 60 * 60 * 1000;

  const [feedsTotal, feedsDisabled, feedsDue, feedsErrors] = await Promise.all([
    getCount(db, 'SELECT COUNT(*) as count FROM feeds'),
    getCount(db, 'SELECT COUNT(*) as count FROM feeds WHERE disabled = 1'),
    getCount(db, 'SELECT COUNT(*) as count FROM feeds WHERE disabled = 0 AND (next_poll_at IS NULL OR next_poll_at <= ?)', [
      timestamp
    ]),
    getCount(db, 'SELECT COUNT(*) as count FROM feeds WHERE error_count > 0')
  ]);

  const statuses = await dbAll<{ status: string; count: number }>(
    db,
    'SELECT status, COUNT(*) as count FROM jobs GROUP BY status'
  );
  const jobs = {
    pending: 0,
    running: 0,
    failed: 0,
    done: 0,
    cancelled: 0
  };
  for (const row of statuses) {
    if (row.status in jobs) {
      jobs[row.status as keyof typeof jobs] = row.count ?? 0;
    }
  }

  const [latestPull, success24h, failed24h, articles, summaries, scores, chatMessages] = await Promise.all([
    dbGet<{
      id: string;
      status: string;
      started_at: number | null;
      completed_at: number | null;
      last_error: string | null;
    }>(
      db,
      `SELECT id, status, started_at, completed_at, last_error
       FROM pull_runs
       ORDER BY created_at DESC
       LIMIT 1`
    ),
    getCount(db, "SELECT COUNT(*) as count FROM pull_runs WHERE status = 'success' AND created_at >= ?", [since24h]),
    getCount(db, "SELECT COUNT(*) as count FROM pull_runs WHERE status = 'failed' AND created_at >= ?", [since24h]),
    getCount(db, 'SELECT COUNT(*) as count FROM articles'),
    getCount(db, 'SELECT COUNT(*) as count FROM article_summaries'),
    getCount(db, 'SELECT COUNT(*) as count FROM article_scores'),
    getCount(db, 'SELECT COUNT(*) as count FROM chat_messages')
  ]);

  const warnings: string[] = [];
  if (jobs.pending > PENDING_JOBS_WARN_THRESHOLD) {
    warnings.push(`High pending jobs backlog: ${jobs.pending} (> ${PENDING_JOBS_WARN_THRESHOLD}).`);
  }
  if (feedsErrors > FEEDS_ERROR_WARN_THRESHOLD) {
    warnings.push(`Many feeds currently erroring: ${feedsErrors} (> ${FEEDS_ERROR_WARN_THRESHOLD}).`);
  }
  if (articles > ARTICLE_ROWS_WARN_THRESHOLD) {
    warnings.push(`Article row count is high: ${articles} (> ${ARTICLE_ROWS_WARN_THRESHOLD}). Consider retention cleanup.`);
  }
  if (latestPull?.status === 'running') {
    const startedAt = latestPull.started_at ?? 0;
    if (startedAt > 0 && timestamp - startedAt > PULL_STALE_WARN_MS) {
      warnings.push('Latest pull run appears stale (running longer than expected).');
    }
  }

  return {
    timestamp,
    feeds: {
      total: feedsTotal,
      disabled: feedsDisabled,
      due: feedsDue,
      with_errors: feedsErrors
    },
    jobs,
    pull: {
      latest_run_id: latestPull?.id ?? null,
      latest_status: latestPull?.status ?? null,
      latest_started_at: latestPull?.started_at ?? null,
      latest_completed_at: latestPull?.completed_at ?? null,
      latest_error: latestPull?.last_error ?? null,
      success_24h: success24h,
      failed_24h: failed24h
    },
    data_volume: {
      articles,
      summaries,
      scores,
      chat_messages: chatMessages
    },
    warnings
  };
}

