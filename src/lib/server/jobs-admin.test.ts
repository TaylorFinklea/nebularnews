import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbRunMock = vi.hoisted(() => vi.fn());

vi.mock('./db', () => ({
  dbAll: vi.fn(),
  dbGet: vi.fn(),
  dbRun: dbRunMock,
  getAffectedRows: (result: { meta?: { changes?: number }; changes?: number } | null) =>
    Number(result?.meta?.changes ?? result?.changes ?? 0),
  now: () => 1_700_000_000_000
}));

vi.mock('./jobs', () => ({
  processJobs: vi.fn()
}));

import { clampQueueCycles, normalizeJobFilter, queueMissingRecentArticleJobs } from './jobs-admin';

describe('normalizeJobFilter', () => {
  it('falls back to all for unknown values', () => {
    expect(normalizeJobFilter('wat')).toBe('all');
  });

  it('accepts known values', () => {
    expect(normalizeJobFilter('pending')).toBe('pending');
    expect(normalizeJobFilter('failed')).toBe('failed');
  });
});

describe('clampQueueCycles', () => {
  it('clamps lower bound', () => {
    expect(clampQueueCycles(0)).toBe(1);
  });

  it('clamps upper bound', () => {
    expect(clampQueueCycles(100)).toBe(10);
  });
});

describe('queueMissingRecentArticleJobs', () => {
  beforeEach(() => {
    dbRunMock.mockReset();
    dbRunMock
      .mockResolvedValueOnce({ meta: { changes: 2 } })
      .mockResolvedValueOnce({ meta: { changes: 3 } })
      .mockResolvedValueOnce({ meta: { changes: 1 } })
      .mockResolvedValueOnce({ meta: { changes: 4 } });
  });

  it('queues score, auto-tag, image backfill, and key_points jobs for the recent window', async () => {
    const referenceAt = Date.UTC(2026, 2, 3, 12, 0, 0);
    const queued = await queueMissingRecentArticleJobs({} as any, {
      referenceAt,
      lookbackHours: 72
    });

    expect(dbRunMock).toHaveBeenCalledTimes(4);
    expect(queued).toEqual({
      windowStart: referenceAt - 72 * 60 * 60 * 1000,
      windowEnd: referenceAt,
      lookbackHours: 72,
      scoreQueued: 2,
      autoTagQueued: 3,
      imageBackfillQueued: 1,
      keyPointsQueued: 4
    });

    const scoreSql = String(dbRunMock.mock.calls[0][1]);
    const autoTagSql = String(dbRunMock.mock.calls[1][1]);
    const imageSql = String(dbRunMock.mock.calls[2][1]);
    const keyPointsSql = String(dbRunMock.mock.calls[3][1]);

    expect(scoreSql).not.toContain("'summarize'");
    expect(scoreSql).toContain("COALESCE(a.published_at, a.fetched_at) <= ?");
    expect(autoTagSql).toContain("j.type = 'auto_tag'");
    expect(imageSql).toContain("image_status");
    expect(keyPointsSql).toContain("'key_points'");
    expect(keyPointsSql).toContain("article_summaries");
  });

  it('defaults the recent lookback to 72 hours', async () => {
    const referenceAt = Date.UTC(2026, 2, 3, 12, 0, 0);

    await queueMissingRecentArticleJobs({} as any, { referenceAt });

    const params = dbRunMock.mock.calls[0]?.[2] as unknown[];
    expect(params[3]).toBe(referenceAt - 72 * 60 * 60 * 1000);
    expect(params[4]).toBe(referenceAt);
  });
});
