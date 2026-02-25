import { dbAll, dbRun, dbGet, type Db } from './db';

export const MIN_ORPHAN_CLEANUP_LIMIT = 10;
export const MAX_ORPHAN_CLEANUP_LIMIT = 1000;
export const DEFAULT_MANUAL_ORPHAN_CLEANUP_LIMIT = 200;
export const DEFAULT_SCHEDULED_ORPHAN_CLEANUP_LIMIT = 50;
export const ORPHAN_PREVIEW_SAMPLE_SIZE = 10;

const placeholders = (count: number) => Array.from({ length: count }, () => '?').join(', ');

export type OrphanCleanupStats = {
  orphan_count_before: number;
  targeted: number;
  deleted_articles: number;
  deleted_article_search_rows: number;
  deleted_jobs_rows: number;
  deleted_chat_threads_rows: number;
  orphan_count_after: number;
  has_more: boolean;
  dry_run: boolean;
};

export const clampOrphanCleanupLimit = (
  value: unknown,
  fallback = DEFAULT_MANUAL_ORPHAN_CLEANUP_LIMIT
) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(MIN_ORPHAN_CLEANUP_LIMIT, Math.min(MAX_ORPHAN_CLEANUP_LIMIT, Math.round(parsed)));
};

const clampListLimit = (value: unknown, fallback = ORPHAN_PREVIEW_SAMPLE_SIZE) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(MAX_ORPHAN_CLEANUP_LIMIT, Math.round(parsed)));
};

export const countOrphanArticles = async (db: Db) => {
  const row = await dbGet<{ count: number }>(
    db,
    `SELECT COUNT(*) AS count
     FROM articles a
     WHERE NOT EXISTS (
       SELECT 1
       FROM article_sources s
       WHERE s.article_id = a.id
     )`
  );
  return Number(row?.count ?? 0);
};

export const listOrphanArticleIds = async (db: Db, limit: number) => {
  const safeLimit = clampListLimit(limit, ORPHAN_PREVIEW_SAMPLE_SIZE);
  const rows = await dbAll<{ id: string }>(
    db,
    `SELECT a.id
     FROM articles a
     WHERE NOT EXISTS (
       SELECT 1
       FROM article_sources s
       WHERE s.article_id = a.id
     )
     ORDER BY COALESCE(a.published_at, a.fetched_at, 0) DESC, a.id ASC
     LIMIT ?`,
    [safeLimit]
  );
  return rows.map((row) => row.id);
};

export async function deleteOrphanArticlesBatch(
  db: Db,
  limit: number,
  options: { dryRun?: boolean } = {}
): Promise<OrphanCleanupStats> {
  const dryRun = Boolean(options.dryRun);
  const safeLimit = clampListLimit(limit, DEFAULT_MANUAL_ORPHAN_CLEANUP_LIMIT);
  const orphanCountBefore = await countOrphanArticles(db);
  const ids = await listOrphanArticleIds(db, safeLimit);
  const targeted = ids.length;

  if (dryRun || targeted === 0) {
    return {
      orphan_count_before: orphanCountBefore,
      targeted,
      deleted_articles: 0,
      deleted_article_search_rows: 0,
      deleted_jobs_rows: 0,
      deleted_chat_threads_rows: 0,
      orphan_count_after: orphanCountBefore,
      has_more: orphanCountBefore > targeted,
      dry_run: dryRun
    };
  }

  const params = ids;
  const inClause = placeholders(params.length);

  const deleteSearch = await dbRun(
    db,
    `DELETE FROM article_search
     WHERE article_id IN (${inClause})`,
    params
  );
  const deleteJobs = await dbRun(
    db,
    `DELETE FROM jobs
     WHERE article_id IN (${inClause})`,
    params
  );
  const deleteThreads = await dbRun(
    db,
    `DELETE FROM chat_threads
     WHERE scope = 'article'
       AND article_id IN (${inClause})`,
    params
  );
  const deleteArticles = await dbRun(
    db,
    `DELETE FROM articles
     WHERE id IN (${inClause})`,
    params
  );

  const orphanCountAfter = await countOrphanArticles(db);
  return {
    orphan_count_before: orphanCountBefore,
    targeted,
    deleted_articles: Number(deleteArticles.meta?.changes ?? 0),
    deleted_article_search_rows: Number(deleteSearch.meta?.changes ?? 0),
    deleted_jobs_rows: Number(deleteJobs.meta?.changes ?? 0),
    deleted_chat_threads_rows: Number(deleteThreads.meta?.changes ?? 0),
    orphan_count_after: orphanCountAfter,
    has_more: orphanCountAfter > 0,
    dry_run: false
  };
}
