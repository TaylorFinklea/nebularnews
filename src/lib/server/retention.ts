import { dbGet, dbRun, now } from './db';
import { getRetentionConfig, type RetentionMode } from './settings';
import { logInfo, logWarn } from './log';

const DAY_MS = 1000 * 60 * 60 * 24;

export type RetentionCleanupStats = {
  enabled: boolean;
  mode: RetentionMode;
  days: number;
  cutoff_at: number | null;
  articles_targeted: number;
  articles_deleted: number;
  articles_archived: number;
  search_rows_cleared: number;
};

const countTargetArticles = async (db: D1Database, cutoffAt: number) => {
  const row = await dbGet<{ count: number }>(
    db,
    `SELECT COUNT(*) as count
     FROM articles
     WHERE COALESCE(published_at, fetched_at, 0) > 0
       AND COALESCE(published_at, fetched_at, 0) < ?`,
    [cutoffAt]
  );
  return row?.count ?? 0;
};

export async function runRetentionCleanup(env: App.Platform['env']): Promise<RetentionCleanupStats> {
  const config = await getRetentionConfig(env.DB);
  if (config.days <= 0) {
    return {
      enabled: false,
      mode: config.mode,
      days: config.days,
      cutoff_at: null,
      articles_targeted: 0,
      articles_deleted: 0,
      articles_archived: 0,
      search_rows_cleared: 0
    };
  }

  const cutoffAt = now() - config.days * DAY_MS;
  const targeted = await countTargetArticles(env.DB, cutoffAt);
  if (targeted === 0) {
    return {
      enabled: true,
      mode: config.mode,
      days: config.days,
      cutoff_at: cutoffAt,
      articles_targeted: 0,
      articles_deleted: 0,
      articles_archived: 0,
      search_rows_cleared: 0
    };
  }

  if (config.mode === 'delete') {
    const clearSearch = await dbRun(
      env.DB,
      `DELETE FROM article_search
       WHERE article_id IN (
         SELECT id FROM articles
         WHERE COALESCE(published_at, fetched_at, 0) > 0
           AND COALESCE(published_at, fetched_at, 0) < ?
       )`,
      [cutoffAt]
    );
    const deleteArticles = await dbRun(
      env.DB,
      `DELETE FROM articles
       WHERE COALESCE(published_at, fetched_at, 0) > 0
         AND COALESCE(published_at, fetched_at, 0) < ?`,
      [cutoffAt]
    );

    const stats: RetentionCleanupStats = {
      enabled: true,
      mode: config.mode,
      days: config.days,
      cutoff_at: cutoffAt,
      articles_targeted: targeted,
      articles_deleted: Number(deleteArticles.meta?.changes ?? 0),
      articles_archived: 0,
      search_rows_cleared: Number(clearSearch.meta?.changes ?? 0)
    };
    logInfo('retention.cleanup.completed', stats);
    return stats;
  }

  const archiveArticles = await dbRun(
    env.DB,
    `UPDATE articles
     SET content_html = NULL,
         content_text = NULL
     WHERE COALESCE(published_at, fetched_at, 0) > 0
       AND COALESCE(published_at, fetched_at, 0) < ?
       AND (content_html IS NOT NULL OR content_text IS NOT NULL)`,
    [cutoffAt]
  );
  const clearSearch = await dbRun(
    env.DB,
    `UPDATE article_search
     SET content_text = ''
     WHERE article_id IN (
       SELECT id FROM articles
       WHERE COALESCE(published_at, fetched_at, 0) > 0
         AND COALESCE(published_at, fetched_at, 0) < ?
     )
       AND content_text != ''`,
    [cutoffAt]
  );

  const archived = Number(archiveArticles.meta?.changes ?? 0);
  if (archived === 0) {
    logWarn('retention.cleanup.noop', { mode: config.mode, days: config.days, cutoff_at: cutoffAt, targeted });
  }

  const stats: RetentionCleanupStats = {
    enabled: true,
    mode: config.mode,
    days: config.days,
    cutoff_at: cutoffAt,
    articles_targeted: targeted,
    articles_deleted: 0,
    articles_archived: archived,
    search_rows_cleared: Number(clearSearch.meta?.changes ?? 0)
  };
  logInfo('retention.cleanup.completed', stats);
  return stats;
}

