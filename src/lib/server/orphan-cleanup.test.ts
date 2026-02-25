import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  orphanOrder: [] as string[],
  articleSearchRows: new Set<string>(),
  jobsRows: new Set<string>(),
  threadRows: new Set<string>()
}));

const dbGetMock = vi.hoisted(() => vi.fn());
const dbAllMock = vi.hoisted(() => vi.fn());
const dbRunMock = vi.hoisted(() => vi.fn());

vi.mock('./db', () => ({
  dbGet: dbGetMock,
  dbAll: dbAllMock,
  dbRun: dbRunMock
}));

import {
  clampOrphanCleanupLimit,
  countOrphanArticles,
  listOrphanArticleIds,
  deleteOrphanArticlesBatch
} from './orphan-cleanup';

const extractIds = (params: unknown[]) => params.map((entry) => String(entry));

describe('orphan cleanup helpers', () => {
  beforeEach(() => {
    harness.orphanOrder = ['art-03', 'art-01', 'art-02'];
    harness.articleSearchRows = new Set(harness.orphanOrder);
    harness.jobsRows = new Set(harness.orphanOrder);
    harness.threadRows = new Set(harness.orphanOrder);
    dbGetMock.mockReset();
    dbAllMock.mockReset();
    dbRunMock.mockReset();

    dbGetMock.mockImplementation(async (_db, sql: string) => {
      if (sql.includes('SELECT COUNT(*) AS count') || sql.includes('SELECT COUNT(*) as count')) {
        return { count: harness.orphanOrder.length };
      }
      return null;
    });

    dbAllMock.mockImplementation(async (_db, sql: string, params: unknown[]) => {
      if (!sql.includes('FROM articles a')) return [];
      const limit = Number(params?.[0] ?? 0);
      return harness.orphanOrder.slice(0, limit).map((id) => ({ id }));
    });

    dbRunMock.mockImplementation(async (_db, sql: string, params: unknown[]) => {
      const ids = extractIds(params);
      if (sql.includes('DELETE FROM article_search')) {
        let changes = 0;
        for (const id of ids) {
          if (harness.articleSearchRows.delete(id)) changes += 1;
        }
        return { meta: { changes } };
      }
      if (sql.includes('DELETE FROM jobs')) {
        let changes = 0;
        for (const id of ids) {
          if (harness.jobsRows.delete(id)) changes += 1;
        }
        return { meta: { changes } };
      }
      if (sql.includes('DELETE FROM chat_threads')) {
        let changes = 0;
        for (const id of ids) {
          if (harness.threadRows.delete(id)) changes += 1;
        }
        return { meta: { changes } };
      }
      if (sql.includes('DELETE FROM articles')) {
        const toDelete = new Set(ids);
        const before = harness.orphanOrder.length;
        harness.orphanOrder = harness.orphanOrder.filter((id) => !toDelete.has(id));
        return { meta: { changes: before - harness.orphanOrder.length } };
      }
      return { meta: { changes: 0 } };
    });
  });

  it('clamps cleanup limit into allowed range', () => {
    expect(clampOrphanCleanupLimit(undefined, 200)).toBe(200);
    expect(clampOrphanCleanupLimit(0, 200)).toBe(10);
    expect(clampOrphanCleanupLimit(9999, 200)).toBe(1000);
    expect(clampOrphanCleanupLimit(42, 200)).toBe(42);
  });

  it('counts and lists orphan articles in deterministic order with limit', async () => {
    const count = await countOrphanArticles({} as D1Database);
    const ids = await listOrphanArticleIds({} as D1Database, 2);
    expect(count).toBe(3);
    expect(ids).toEqual(['art-03', 'art-01']);
  });

  it('returns dry run stats without deleting rows', async () => {
    const result = await deleteOrphanArticlesBatch({} as D1Database, 2, { dryRun: true });
    expect(result).toMatchObject({
      orphan_count_before: 3,
      targeted: 2,
      deleted_articles: 0,
      deleted_article_search_rows: 0,
      deleted_jobs_rows: 0,
      deleted_chat_threads_rows: 0,
      orphan_count_after: 3,
      has_more: true,
      dry_run: true
    });
    expect(harness.orphanOrder).toEqual(['art-03', 'art-01', 'art-02']);
    expect(dbRunMock).not.toHaveBeenCalled();
  });

  it('deletes orphan batch and dependent rows', async () => {
    const result = await deleteOrphanArticlesBatch({} as D1Database, 2, { dryRun: false });
    expect(result).toMatchObject({
      orphan_count_before: 3,
      targeted: 2,
      deleted_articles: 2,
      deleted_article_search_rows: 2,
      deleted_jobs_rows: 2,
      deleted_chat_threads_rows: 2,
      orphan_count_after: 1,
      has_more: true,
      dry_run: false
    });
    expect(harness.orphanOrder).toEqual(['art-02']);
  });
});

