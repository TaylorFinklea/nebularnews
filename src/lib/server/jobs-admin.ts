import { dbAll, dbGet, dbRun, now, type Db } from './db';
import { processJobs } from './jobs';
import { dayRangeForTimezoneOffset } from './time';
import { getAutoTaggingEnabled } from './settings';

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

const getAffectedRows = (result: unknown) => {
  const rowInfo = result as { meta?: { changes?: number }; changes?: number } | null;
  return Number(rowInfo?.meta?.changes ?? rowInfo?.changes ?? 0);
};

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

export async function runQueueCycles(env: App.Platform['env'], cycles: number, options?: { forceDue?: boolean }) {
  const runCount = clampQueueCycles(cycles);
  if (options?.forceDue) {
    await dbRun(env.DB, "UPDATE jobs SET run_after = ?, updated_at = ? WHERE status = 'pending'", [now(), now()]);
  }
  const cycleMetrics = [];
  for (let i = 0; i < runCount; i += 1) {
    cycleMetrics.push(await processJobs(env));
  }
  return {
    cycles: runCount,
    counts: await getJobCounts(env.DB),
    metrics: cycleMetrics
  };
}

export async function queueMissingTodayArticleJobs(
  db: Db,
  options?: { referenceAt?: number; tzOffsetMinutes?: number }
) {
  const autoTaggingEnabled = await getAutoTaggingEnabled(db);
  const referenceAt = options?.referenceAt ?? now();
  const range = dayRangeForTimezoneOffset(referenceAt, options?.tzOffsetMinutes ?? 0);
  const { dayStart, dayEnd } = range;
  const runAfter = referenceAt;
  const timestamp = referenceAt;

  const summarizeResult = await dbRun(
    db,
    `INSERT INTO jobs (id, type, article_id, status, attempts, priority, run_after, last_error, provider, model, created_at, updated_at)
     SELECT lower(hex(randomblob(16))), 'summarize', a.id, 'pending', 0, 100, ?, NULL, NULL, NULL, ?, ?
     FROM articles a
     WHERE COALESCE(a.published_at, a.fetched_at) >= ?
       AND COALESCE(a.published_at, a.fetched_at) < ?
       AND NOT EXISTS (SELECT 1 FROM article_summaries s WHERE s.article_id = a.id)
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
    [runAfter, timestamp, timestamp, dayStart, dayEnd]
  );

  const scoreResult = await dbRun(
    db,
    `INSERT INTO jobs (id, type, article_id, status, attempts, priority, run_after, last_error, provider, model, created_at, updated_at)
     SELECT lower(hex(randomblob(16))), 'score', a.id, 'pending', 0, 100, ?, NULL, NULL, NULL, ?, ?
     FROM articles a
     WHERE COALESCE(a.published_at, a.fetched_at) >= ?
       AND COALESCE(a.published_at, a.fetched_at) < ?
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
    [runAfter, timestamp, timestamp, dayStart, dayEnd]
  );

  const autoTagResult = autoTaggingEnabled
    ? await dbRun(
        db,
        `INSERT INTO jobs (id, type, article_id, status, attempts, priority, run_after, last_error, provider, model, created_at, updated_at)
         SELECT lower(hex(randomblob(16))), 'auto_tag', a.id, 'pending', 0, 100, ?, NULL, NULL, NULL, ?, ?
         FROM articles a
         WHERE COALESCE(a.published_at, a.fetched_at) >= ?
           AND COALESCE(a.published_at, a.fetched_at) < ?
           AND NOT EXISTS (
             SELECT 1
             FROM article_tags t
             WHERE t.article_id = a.id
               AND t.source = 'ai'
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
        [runAfter, timestamp, timestamp, dayStart, dayEnd]
      )
    : { meta: { changes: 0 } };

  const imageBackfillResult = await dbRun(
    db,
    `INSERT INTO jobs (id, type, article_id, status, attempts, priority, run_after, last_error, provider, model, created_at, updated_at)
     SELECT lower(hex(randomblob(16))), 'image_backfill', a.id, 'pending', 0, 120, ?, NULL, NULL, NULL, ?, ?
     FROM articles a
     WHERE COALESCE(a.published_at, a.fetched_at) >= ?
       AND COALESCE(a.published_at, a.fetched_at) < ?
       AND (a.image_url IS NULL OR a.image_url = '')
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
    [runAfter, timestamp, timestamp, dayStart, dayEnd]
  );

  return {
    dayStart,
    dayEnd,
    tzOffsetMinutes: range.tzOffsetMinutes,
    summarizeQueued: getAffectedRows(summarizeResult),
    scoreQueued: getAffectedRows(scoreResult),
    autoTagQueued: getAffectedRows(autoTagResult),
    imageBackfillQueued: getAffectedRows(imageBackfillResult)
  };
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
