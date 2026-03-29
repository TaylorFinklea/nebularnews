import { dbAll, dbGet, dbRun, getAffectedRows, now, type Db } from './db';
import type { Env } from './env';
import { processJobs } from './jobs';

const JOB_FILTERS = ['all', 'pending', 'running', 'failed', 'done', 'cancelled'] as const;
const MAX_LIMIT = 250;
const MAX_QUEUE_CYCLES = 10;

export type JobFilter = (typeof JOB_FILTERS)[number];

export type JobCounts = {
  total: number;
  pending: number;
  running: number;
  failed: number;
  done: number;
  cancelled: number;
};

export type JobRow = {
  id: string;
  type: string;
  article_id: string | null;
  article_title: string | null;
  article_url: string | null;
  status: string;
  attempts: number;
  run_after: number;
  last_error: string | null;
  provider: string | null;
  model: string | null;
};

export const normalizeJobFilter = (value: string | null | undefined): JobFilter => {
  if (!value) return 'all';
  return JOB_FILTERS.includes(value as JobFilter) ? (value as JobFilter) : 'all';
};

export const clampQueueCycles = (value: unknown, fallback = 1) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(MAX_QUEUE_CYCLES, Math.max(1, Math.floor(parsed)));
};

const clampLimit = (value: unknown, fallback = 100) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(parsed)));
};

const DEFAULT_RECENT_MISSING_LOOKBACK_HOURS = 72;

export async function listJobs(db: Db, options?: { status?: JobFilter; limit?: number }) {
  const status = normalizeJobFilter(options?.status);
  const limit = clampLimit(options?.limit);
  const where = status === 'all' ? '' : 'WHERE j.status = ?';
  const params = status === 'all' ? [limit] : [status, limit];

  return dbAll<JobRow>(
    db,
    `SELECT
      j.id,
      j.type,
      j.article_id,
      a.title as article_title,
      a.canonical_url as article_url,
      j.status,
      j.attempts,
      j.run_after,
      j.last_error,
      j.provider,
      j.model
    FROM jobs j
    LEFT JOIN articles a ON a.id = j.article_id
    ${where}
    ORDER BY
      CASE j.status
        WHEN 'running' THEN 0
        WHEN 'pending' THEN 1
        WHEN 'failed' THEN 2
        WHEN 'cancelled' THEN 3
        ELSE 4
      END,
      j.run_after ASC
    LIMIT ?`,
    params
  );
}

export async function getJobCounts(db: Db): Promise<JobCounts> {
  const row = await dbGet<{
    total: number | null;
    pending: number | null;
    running: number | null;
    failed: number | null;
    done: number | null;
    cancelled: number | null;
  }>(
    db,
    `SELECT
      COUNT(*) as total,
      COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) as pending,
      COALESCE(SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END), 0) as running,
      COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) as failed,
      COALESCE(SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END), 0) as done,
      COALESCE(SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END), 0) as cancelled
    FROM jobs`
  );

  return {
    total: Number(row?.total ?? 0),
    pending: Number(row?.pending ?? 0),
    running: Number(row?.running ?? 0),
    failed: Number(row?.failed ?? 0),
    done: Number(row?.done ?? 0),
    cancelled: Number(row?.cancelled ?? 0)
  };
}

export async function getJobStatus(db: Db, jobId: string) {
  const row = await dbGet<{ status: string }>(db, 'SELECT status FROM jobs WHERE id = ? LIMIT 1', [jobId]);
  return row?.status ?? null;
}

export async function runQueueCycles(db: Db, env: Env, cycles: number, options?: { forceDue?: boolean }) {
  const runCount = clampQueueCycles(cycles);
  if (options?.forceDue) {
    await dbRun(db, "UPDATE jobs SET run_after = ?, updated_at = ? WHERE status = 'pending'", [now(), now()]);
  }
  const cycleMetrics = [];
  for (let i = 0; i < runCount; i += 1) {
    cycleMetrics.push(await processJobs(db, env));
  }
  return {
    cycles: runCount,
    counts: await getJobCounts(db),
    metrics: cycleMetrics
  };
}

export async function queueMissingRecentArticleJobs(
  db: Db,
  options?: { referenceAt?: number; lookbackHours?: number }
) {
  const referenceAt = options?.referenceAt ?? now();
  const lookbackHours = Math.max(1, Math.floor(options?.lookbackHours ?? DEFAULT_RECENT_MISSING_LOOKBACK_HOURS));
  const windowStart = referenceAt - lookbackHours * 60 * 60 * 1000;
  const windowEnd = referenceAt;
  const runAfter = referenceAt;
  const timestamp = referenceAt;

  const scoreResult = await dbRun(
    db,
    `INSERT INTO jobs (id, type, article_id, status, attempts, priority, run_after, last_error, provider, model, created_at, updated_at)
     SELECT encode(gen_random_bytes(16), 'hex'), 'score', a.id, 'pending', 0, 100, ?, NULL, NULL, NULL, ?, ?
     FROM articles a
     WHERE COALESCE(a.published_at, a.fetched_at) >= ?
       AND COALESCE(a.published_at, a.fetched_at) <= ?
       AND NOT EXISTS (SELECT 1 FROM article_scores s WHERE s.article_id = a.id)
       AND NOT EXISTS (SELECT 1 FROM article_score_overrides o WHERE o.article_id = a.id)
     ON CONFLICT(type, article_id) DO UPDATE SET
       status = excluded.status,
       attempts = 0,
       priority = excluded.priority,
       run_after = excluded.run_after,
       last_error = NULL,
       provider = NULL,
       model = NULL,
       locked_by = NULL,
       locked_at = NULL,
       lease_expires_at = NULL,
       updated_at = excluded.updated_at`,
    [runAfter, timestamp, timestamp, windowStart, windowEnd]
  );

  const autoTagResult = await dbRun(
    db,
    `INSERT INTO jobs (id, type, article_id, status, attempts, priority, run_after, last_error, provider, model, created_at, updated_at)
     SELECT encode(gen_random_bytes(16), 'hex'), 'auto_tag', a.id, 'pending', 0, 100, ?, NULL, NULL, NULL, ?, ?
     FROM articles a
     WHERE COALESCE(a.published_at, a.fetched_at) >= ?
       AND COALESCE(a.published_at, a.fetched_at) <= ?
       AND NOT EXISTS (
         SELECT 1
         FROM article_tags t
         WHERE t.article_id = a.id
           AND t.source IN ('ai', 'system')
       )
       AND NOT EXISTS (
         SELECT 1
         FROM jobs j
         WHERE j.article_id = a.id
           AND j.type = 'auto_tag'
           AND j.status = 'done'
       )
     ON CONFLICT(type, article_id) DO UPDATE SET
       status = excluded.status,
       attempts = 0,
       priority = excluded.priority,
       run_after = excluded.run_after,
       last_error = NULL,
       provider = NULL,
       model = NULL,
       locked_by = NULL,
       locked_at = NULL,
       lease_expires_at = NULL,
       updated_at = excluded.updated_at`,
    [runAfter, timestamp, timestamp, windowStart, windowEnd]
  );

  const imageBackfillResult = await dbRun(
    db,
    `INSERT INTO jobs (id, type, article_id, status, attempts, priority, run_after, last_error, provider, model, created_at, updated_at)
     SELECT encode(gen_random_bytes(16), 'hex'), 'image_backfill', a.id, 'pending', 0, 120, ?, NULL, NULL, NULL, ?, ?
     FROM articles a
     WHERE COALESCE(a.published_at, a.fetched_at) >= ?
       AND COALESCE(a.published_at, a.fetched_at) <= ?
       AND COALESCE(a.image_status, '') NOT IN ('found', 'missing')
     ON CONFLICT(type, article_id) DO UPDATE SET
       status = excluded.status,
       attempts = 0,
       priority = excluded.priority,
       run_after = excluded.run_after,
       last_error = NULL,
       provider = NULL,
       model = NULL,
       locked_by = NULL,
       locked_at = NULL,
       lease_expires_at = NULL,
       updated_at = excluded.updated_at`,
    [runAfter, timestamp, timestamp, windowStart, windowEnd]
  );

  const keyPointsResult = await dbRun(
    db,
    `INSERT INTO jobs (id, type, article_id, status, attempts, priority, run_after, last_error, provider, model, created_at, updated_at)
     SELECT encode(gen_random_bytes(16), 'hex'), 'key_points', a.id, 'pending', 0, 100, ?, NULL, NULL, NULL, ?, ?
     FROM articles a
     WHERE COALESCE(a.published_at, a.fetched_at) >= ?
       AND COALESCE(a.published_at, a.fetched_at) <= ?
       AND EXISTS (SELECT 1 FROM article_summaries s WHERE s.article_id = a.id)
       AND NOT EXISTS (SELECT 1 FROM article_key_points kp WHERE kp.article_id = a.id)
     ON CONFLICT(type, article_id) DO UPDATE SET
       status = excluded.status,
       attempts = 0,
       priority = excluded.priority,
       run_after = excluded.run_after,
       last_error = NULL,
       provider = NULL,
       model = NULL,
       locked_by = NULL,
       locked_at = NULL,
       lease_expires_at = NULL,
       updated_at = excluded.updated_at`,
    [runAfter, timestamp, timestamp, windowStart, windowEnd]
  );

  return {
    windowStart,
    windowEnd,
    lookbackHours,
    scoreQueued: getAffectedRows(scoreResult),
    autoTagQueued: getAffectedRows(autoTagResult),
    imageBackfillQueued: getAffectedRows(imageBackfillResult),
    keyPointsQueued: getAffectedRows(keyPointsResult)
  };
}

export async function queueMissingKeyPoints(db: Db) {
  const timestamp = now();
  const result = await dbRun(
    db,
    `INSERT INTO jobs (id, type, article_id, status, attempts, priority, run_after, last_error, provider, model, created_at, updated_at)
     SELECT encode(gen_random_bytes(16), 'hex'), 'key_points', a.id, 'pending', 0, 80, ?, NULL, NULL, NULL, ?, ?
     FROM articles a
     WHERE EXISTS (SELECT 1 FROM article_summaries s WHERE s.article_id = a.id)
       AND NOT EXISTS (SELECT 1 FROM article_key_points kp WHERE kp.article_id = a.id)
     ON CONFLICT(type, article_id) DO UPDATE SET
       status = excluded.status,
       attempts = 0,
       priority = excluded.priority,
       run_after = excluded.run_after,
       last_error = NULL,
       provider = NULL,
       model = NULL,
       locked_by = NULL,
       locked_at = NULL,
       lease_expires_at = NULL,
       updated_at = excluded.updated_at`,
    [timestamp, timestamp, timestamp]
  );
  return { queued: getAffectedRows(result) };
}

export async function queueRefetchContent(db: Db) {
  const timestamp = now();
  const result = await dbRun(
    db,
    `INSERT INTO jobs (id, type, article_id, status, attempts, priority, run_after, last_error, provider, model, created_at, updated_at)
     SELECT encode(gen_random_bytes(16), 'hex'), 'refetch_content', a.id, 'pending', 0, 90, ?, NULL, NULL, NULL, ?, ?
     FROM articles a
     WHERE a.canonical_url IS NOT NULL
       AND (a.content_text IS NULL OR length(a.content_text) < 200)
     ON CONFLICT(type, article_id) DO UPDATE SET
       status = excluded.status,
       attempts = 0,
       priority = excluded.priority,
       run_after = excluded.run_after,
       last_error = NULL,
       provider = NULL,
       model = NULL,
       locked_by = NULL,
       locked_at = NULL,
       lease_expires_at = NULL,
       updated_at = excluded.updated_at`,
    [timestamp, timestamp, timestamp]
  );
  return { queued: getAffectedRows(result) };
}

export async function retryFailedJobs(db: Db) {
  const result = await dbRun(
    db,
    `UPDATE jobs
     SET status = 'pending',
         attempts = 0,
         run_after = ?,
         last_error = NULL,
         provider = NULL,
         model = NULL,
         locked_by = NULL,
         locked_at = NULL,
         lease_expires_at = NULL,
         updated_at = ?
     WHERE status = 'failed'`,
    [now(), now()]
  );
  return getAffectedRows(result);
}

export async function markJobPendingNow(db: Db, jobId: string) {
  const result = await dbRun(
    db,
    `UPDATE jobs
     SET status = 'pending',
         attempts = 0,
         run_after = ?,
         last_error = NULL,
         provider = NULL,
         model = NULL,
         locked_by = NULL,
         locked_at = NULL,
         lease_expires_at = NULL,
         updated_at = ?
     WHERE id = ? AND status <> 'running'`,
    [now(), now(), jobId]
  );
  return getAffectedRows(result);
}

export async function cancelPendingJob(db: Db, jobId: string) {
  const result = await dbRun(
    db,
    `UPDATE jobs
     SET status = 'cancelled',
         locked_by = NULL,
         locked_at = NULL,
         lease_expires_at = NULL,
         updated_at = ?
     WHERE id = ? AND status = 'pending'`,
    [now(), jobId]
  );
  return getAffectedRows(result);
}

export async function cancelAllPendingJobs(db: Db) {
  const result = await dbRun(
    db,
    `UPDATE jobs
     SET status = 'cancelled',
         locked_by = NULL,
         locked_at = NULL,
         lease_expires_at = NULL,
         updated_at = ?
     WHERE status = 'pending'`,
    [now()]
  );
  return getAffectedRows(result);
}

export async function clearFinishedJobs(db: Db) {
  const result = await dbRun(db, "DELETE FROM jobs WHERE status IN ('done', 'cancelled')");
  return getAffectedRows(result);
}

export async function deleteJob(db: Db, jobId: string) {
  const result = await dbRun(db, "DELETE FROM jobs WHERE id = ? AND status <> 'running'", [jobId]);
  return getAffectedRows(result);
}
