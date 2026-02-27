import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbAllMock = vi.hoisted(() => vi.fn());
const dbGetMock = vi.hoisted(() => vi.fn());
const preferredSourcesMock = vi.hoisted(() => vi.fn());

vi.mock('./db', () => ({
  dbAll: dbAllMock,
  dbGet: dbGetMock
}));

vi.mock('./sources', () => ({
  getPreferredSourcesForArticles: preferredSourcesMock
}));

import {
  getDashboardFeedStatus,
  getDashboardReadingMomentum,
  getDashboardUnreadQueue
} from './dashboard';

const DAY_MS = 1000 * 60 * 60 * 24;

describe('dashboard queries', () => {
  beforeEach(() => {
    dbAllMock.mockReset();
    dbGetMock.mockReset();
    preferredSourcesMock.mockReset();
    preferredSourcesMock.mockResolvedValue(new Map());
  });

  it('queries unread queue with rolling window + score-first fallback params', async () => {
    const referenceAt = Date.UTC(2026, 1, 27, 12, 0, 0);

    dbAllMock.mockResolvedValue([
      {
        id: 'a-1',
        title: 'High fit story',
        canonical_url: 'https://example.com/a-1',
        image_url: null,
        published_at: referenceAt - DAY_MS,
        fetched_at: referenceAt - DAY_MS,
        excerpt: 'excerpt',
        summary_text: 'summary',
        score: 5,
        label: 'Very relevant'
      },
      {
        id: 'a-2',
        title: 'Recent fallback story',
        canonical_url: 'https://example.com/a-2',
        image_url: null,
        published_at: referenceAt - DAY_MS,
        fetched_at: referenceAt - DAY_MS,
        excerpt: 'excerpt',
        summary_text: 'summary',
        score: 2,
        label: 'Lower relevance'
      }
    ]);

    preferredSourcesMock.mockResolvedValue(
      new Map([
        ['a-1', { sourceName: 'Alpha Feed' }],
        ['a-2', { sourceName: 'Beta Feed' }]
      ])
    );

    const result = await getDashboardUnreadQueue({} as D1Database, {
      windowDays: 7,
      scoreCutoff: 3,
      limit: 6,
      referenceAt
    });

    expect(dbAllMock).toHaveBeenCalledTimes(1);
    const [_db, sql, params] = dbAllMock.mock.calls[0];
    expect(sql).toContain('COALESCE(a.published_at, a.fetched_at, 0) >= ?');
    expect(sql).toContain('SELECT rs.is_read FROM article_read_state rs');
    expect(sql).toContain('CASE WHEN COALESCE(o.score, lsc.score) >= ? THEN 0 ELSE 1 END ASC');
    expect(params).toEqual([referenceAt - 7 * DAY_MS, 3, 6]);

    expect(result).toEqual([
      expect.objectContaining({
        id: 'a-1',
        queue_reason: 'high_fit',
        source_name: 'Alpha Feed'
      }),
      expect.objectContaining({
        id: 'a-2',
        queue_reason: 'recent_unread',
        source_name: 'Beta Feed'
      })
    ]);
  });

  it('clamps queue inputs before querying', async () => {
    const referenceAt = Date.UTC(2026, 1, 27, 12, 0, 0);
    dbAllMock.mockResolvedValue([]);

    await getDashboardUnreadQueue({} as D1Database, {
      windowDays: 0,
      scoreCutoff: 99,
      limit: 0,
      referenceAt
    });

    const [, , params] = dbAllMock.mock.calls[0];
    expect(params).toEqual([referenceAt - DAY_MS, 5, 1]);
  });

  it('returns reading momentum aggregates with expected time windows', async () => {
    const referenceAt = Date.UTC(2026, 1, 27, 12, 0, 0);
    dbGetMock.mockResolvedValue({
      unread_total: 25,
      unread_24h: 4,
      unread_7d: 13,
      high_fit_unread_7d: 6
    });

    const result = await getDashboardReadingMomentum({} as D1Database, {
      scoreCutoff: 4,
      referenceAt
    });

    expect(dbGetMock).toHaveBeenCalledTimes(1);
    const [_db, sql, params] = dbGetMock.mock.calls[0];
    expect(sql).toContain('FROM unread_articles');
    expect(sql).toContain('SELECT rs.is_read FROM article_read_state rs');
    expect(sql).toContain('score >= ?');
    expect(params).toEqual([referenceAt - DAY_MS, referenceAt - 7 * DAY_MS, referenceAt - 7 * DAY_MS, 4]);

    expect(result).toEqual({
      unreadTotal: 25,
      unread24h: 4,
      unread7d: 13,
      highFitUnread7d: 6
    });
  });

  it('returns feed status with hasFeeds convenience flag', async () => {
    dbGetMock.mockResolvedValue({ feed_count: 2 });

    await expect(getDashboardFeedStatus({} as D1Database)).resolves.toEqual({
      feedCount: 2,
      hasFeeds: true
    });

    dbGetMock.mockResolvedValue({ feed_count: 0 });
    await expect(getDashboardFeedStatus({} as D1Database)).resolves.toEqual({
      feedCount: 0,
      hasFeeds: false
    });
  });
});
