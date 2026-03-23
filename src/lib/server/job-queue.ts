import { nanoid } from 'nanoid';
import { dbBatch, dbRun, now, type Db } from './db';

export type ArticleJobType =
  | 'summarize'
  | 'score'
  | 'key_points'
  | 'auto_tag'
  | 'image_backfill'
  | 'refetch_content'
  | 'browser_scrape';

const DEFAULT_JOB_PRIORITY: Record<ArticleJobType, number> = {
  summarize: 100,
  score: 100,
  key_points: 100,
  auto_tag: 100,
  browser_scrape: 85,
  refetch_content: 90,
  image_backfill: 120
};

export const enqueueArticleJob = async (
  db: Db,
  type: ArticleJobType,
  articleId: string,
  priority = DEFAULT_JOB_PRIORITY[type]
) => {
  const timestamp = now();
  await dbRun(
    db,
    `INSERT INTO jobs (id, type, article_id, status, attempts, priority, run_after, last_error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
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
    [nanoid(), type, articleId, 'pending', 0, priority, timestamp, timestamp, timestamp]
  );
};

export const enqueueScoreJob = async (db: Db, articleId: string, priority = 100) =>
  enqueueArticleJob(db, 'score', articleId, priority);

export const enqueueNewArticleArtifactJobs = async (
  db: Db,
  articleId: string,
  options?: {
    queuedAt?: number;
    includeSummaries?: boolean;
    includeImageBackfill?: boolean;
  }
) => {
  const queuedAt = options?.queuedAt ?? now();
  const jobTypes: ArticleJobType[] = ['score', 'auto_tag', 'key_points'];

  if (options?.includeSummaries) {
    jobTypes.unshift('summarize');
  }

  if (options?.includeImageBackfill) {
    jobTypes.push('image_backfill');
  }

  await dbBatch(
    db,
    jobTypes.map((type) => ({
      sql: `INSERT INTO jobs (id, type, article_id, status, attempts, priority, run_after, last_error, provider, model, created_at, updated_at)
            VALUES (?, ?, ?, 'pending', 0, ?, ?, NULL, NULL, NULL, ?, ?)
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
      params: [nanoid(), type, articleId, DEFAULT_JOB_PRIORITY[type], queuedAt, queuedAt, queuedAt]
    }))
  );

  return jobTypes;
};
