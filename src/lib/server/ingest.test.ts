import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbGetMock = vi.hoisted(() => vi.fn());
const dbRunMock = vi.hoisted(() => vi.fn());
const enqueueNewArticleArtifactJobsMock = vi.hoisted(() => vi.fn(async () => ['score', 'auto_tag', 'image_backfill']));

vi.mock('./db', () => ({
  dbAll: vi.fn(),
  dbBatch: vi.fn(),
  dbGet: dbGetMock,
  dbRun: dbRunMock,
  getAffectedRows: (result: { meta?: { changes?: number }; changes?: number } | null) =>
    Number(result?.meta?.changes ?? result?.changes ?? 0),
  now: vi.fn(() => Date.UTC(2026, 2, 3, 0, 5, 0))
}));

vi.mock('./feeds', () => ({
  fetchAndParseFeed: vi.fn()
}));

vi.mock('./text', () => ({
  computeWordCount: vi.fn(() => 42),
  extractMainContent: vi.fn(),
  BROWSER_USER_AGENT: 'Mozilla/5.0 (compatible; NebularNews/1.0; +https://nebularnews.app)',
  BROWSER_ACCEPT: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
}));

vi.mock('./images', () => ({
  extractLeadImageUrlFromHtml: vi.fn(() => null),
  normalizeImageUrl: vi.fn((value: string | null) => value)
}));

vi.mock('./settings', () => ({
  clampInitialFeedLookbackDays: vi.fn((value: number) => value),
  getInitialFeedLookbackDays: vi.fn(),
  getMaxFeedsPerPoll: vi.fn(),
  getMaxItemsPerPoll: vi.fn()
}));

vi.mock('./job-queue', () => ({
  enqueueNewArticleArtifactJobs: enqueueNewArticleArtifactJobsMock
}));

import { ingestFeedItem } from './ingest';

describe('ingestFeedItem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbGetMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    dbRunMock
      .mockResolvedValueOnce({ meta: { changes: 1 } })
      .mockResolvedValue({ meta: { changes: 1 } });
  });

  it('queues new article jobs even when the article was published on the previous UTC day', async () => {
    const result = await ingestFeedItem({} as any, 'feed-1', {
      url: 'https://example.com/story',
      guid: 'story-1',
      title: 'Kansas City small businesses have 100 days to get World Cup ready',
      author: 'Reporter',
      publishedAt: Date.UTC(2026, 2, 2, 22, 0, 0),
      contentHtml: null,
      contentText: 'Article body text',
      imageUrl: null
    });

    expect(result).toBe(true);
    expect(enqueueNewArticleArtifactJobsMock).toHaveBeenCalledWith(expect.anything(), expect.any(String), {
      queuedAt: Date.UTC(2026, 2, 3, 0, 5, 0),
      includeSummaries: false,
      includeImageBackfill: true
    });
  });

  it('treats meta.changes as an inserted row for job queueing', async () => {
    dbRunMock.mockReset();
    dbGetMock.mockReset();
    dbGetMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    dbRunMock
      .mockResolvedValueOnce({ meta: { changes: 1 } })
      .mockResolvedValue({ meta: { changes: 1 } });

    await ingestFeedItem({} as any, 'feed-1', {
      url: 'https://example.com/meta-changes',
      guid: 'story-2',
      title: 'Meta changes story',
      author: null,
      publishedAt: Date.UTC(2026, 2, 3, 0, 1, 0),
      contentHtml: null,
      contentText: 'Article body text',
      imageUrl: null
    });

    expect(enqueueNewArticleArtifactJobsMock).toHaveBeenCalledTimes(1);
  });
});
