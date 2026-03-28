import { dbRun, now, type Db } from './db';
import { getRetentionConfig } from './settings';
import { logInfo } from './log';

const DAY_MS = 1000 * 60 * 60 * 24;

const SAVED_EXCLUSION = `AND NOT EXISTS (
  SELECT 1 FROM article_read_state
  WHERE article_id = articles.id AND saved_at IS NOT NULL
)`;

const AGE_FILTER = `COALESCE(published_at, fetched_at, 0) > 0
  AND COALESCE(published_at, fetched_at, 0) < ?`;

export type RetentionCleanupStats = {
  enabled: boolean;
  archive_days: number;
  delete_days: number;
  archive_cutoff_at: number | null;
  delete_cutoff_at: number | null;
  articles_archived: number;
  articles_deleted: number;
  search_rows_cleared: number;
};

export async function runRetentionCleanup(db: Db, env: App.Platform['env']): Promise<RetentionCleanupStats> {
  const config = await getRetentionConfig(db);
  const { archiveDays, deleteDays } = config;

  if (archiveDays <= 0 && deleteDays <= 0) {
    return {
      enabled: false,
      archive_days: archiveDays,
      delete_days: deleteDays,
      archive_cutoff_at: null,
      delete_cutoff_at: null,
      articles_archived: 0,
      articles_deleted: 0,
      search_rows_cleared: 0
    };
  }

  let articlesArchived = 0;
  let articlesDeleted = 0;
  let searchRowsCleared = 0;
  const archiveCutoff = archiveDays > 0 ? now() - archiveDays * DAY_MS : null;
  const deleteCutoff = deleteDays > 0 ? now() - deleteDays * DAY_MS : null;

  // Phase 1: Archive — strip body text for old unsaved articles
  if (archiveCutoff !== null) {
    const archiveResult = await dbRun(
      db,
      `UPDATE articles
       SET content_html = NULL, content_text = NULL
       WHERE ${AGE_FILTER}
         AND (content_html IS NOT NULL OR content_text IS NOT NULL)
         ${SAVED_EXCLUSION}`,
      [archiveCutoff]
    );
    articlesArchived = Number(archiveResult.meta?.changes ?? 0);
  }

  // Phase 2: Delete — remove old unsaved article records entirely
  if (deleteCutoff !== null) {
    const deleteResult = await dbRun(
      db,
      `DELETE FROM articles
       WHERE ${AGE_FILTER} ${SAVED_EXCLUSION}`,
      [deleteCutoff]
    );
    articlesDeleted = Number(deleteResult.meta?.changes ?? 0);
  }

  const stats: RetentionCleanupStats = {
    enabled: true,
    archive_days: archiveDays,
    delete_days: deleteDays,
    archive_cutoff_at: archiveCutoff,
    delete_cutoff_at: deleteCutoff,
    articles_archived: articlesArchived,
    articles_deleted: articlesDeleted,
    search_rows_cleared: searchRowsCleared
  };
  logInfo('retention.cleanup.completed', stats);
  return stats;
}
