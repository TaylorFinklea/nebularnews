import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbGetMock = vi.hoisted(() => vi.fn());
const dbRunMock = vi.hoisted(() => vi.fn(async () => undefined));
const listTagSuggestionsForArticleMock = vi.hoisted(() => vi.fn());
const listTagLinksForArticleMock = vi.hoisted(() => vi.fn());
const listTagsForArticleMock = vi.hoisted(() => vi.fn());
const ensureTagByNameMock = vi.hoisted(() => vi.fn());
const attachTagToArticleMock = vi.hoisted(() => vi.fn(async () => undefined));
const dismissTagSuggestionMock = vi.hoisted(() => vi.fn(async () => undefined));
const undoDismissTagSuggestionMock = vi.hoisted(() => vi.fn(async () => undefined));
const updateTopicAffinityMock = vi.hoisted(() => vi.fn(async () => undefined));
const enqueueScoreJobMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('$lib/server/db', () => ({
  dbGet: dbGetMock,
  dbRun: dbRunMock
}));

vi.mock('$lib/server/tags', () => ({
  attachTagToArticle: attachTagToArticleMock,
  dismissTagSuggestion: dismissTagSuggestionMock,
  ensureTagByName: ensureTagByNameMock,
  listTagLinksForArticle: listTagLinksForArticleMock,
  listTagSuggestionsForArticle: listTagSuggestionsForArticleMock,
  listTagsForArticle: listTagsForArticleMock,
  normalizeTagSuggestionKey: (value: string) => value.trim().toLowerCase(),
  serializeArticleTagLinkState: (links: Array<{ tagId: string; source: string; confidence: number | null }>) =>
    [...links]
      .map((link) => `${link.tagId}:${link.source}:${link.confidence === null ? 'null' : Number(link.confidence).toFixed(3)}`)
      .sort()
      .join('|'),
  undoDismissTagSuggestion: undoDismissTagSuggestionMock
}));

vi.mock('$lib/server/scoring/learning', () => ({
  updateTopicAffinity: updateTopicAffinityMock
}));

vi.mock('$lib/server/job-queue', () => ({
  enqueueScoreJob: enqueueScoreJobMock
}));

vi.mock('$lib/server/api', () => ({
  apiError: vi.fn((_event, status, code, message) =>
    new Response(JSON.stringify({ ok: false, code, error: message }), {
      status,
      headers: { 'content-type': 'application/json' }
    })
  ),
  apiOkWithAliases: vi.fn((_event, data, aliases) =>
    new Response(JSON.stringify({ ok: true, data, aliases }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  )
}));

import { POST } from './+server';

const createEvent = (body: Record<string, unknown>) =>
  ({
    params: { id: 'article-1' },
    request: new Request('https://example.com/api/articles/article-1/tag-suggestions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }),
    platform: {
      env: {
        DB: {} as D1Database
      }
    } as App.Platform,
    locals: { requestId: 'req-test', user: { id: 'admin', role: 'admin' } }
  }) as unknown as Parameters<typeof POST>[0];

describe('/api/articles/[id]/tag-suggestions POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbGetMock.mockResolvedValue({ id: 'article-1' });
    listTagsForArticleMock.mockResolvedValue([]);
    ensureTagByNameMock.mockResolvedValue({ id: 'tag-1' });
  });

  it('queues rescoring when accepting a suggestion changes the tag state', async () => {
    listTagSuggestionsForArticleMock
      .mockResolvedValueOnce([
        {
          id: 'suggestion-1',
          name: 'AI Policy',
          name_normalized: 'ai policy',
          confidence: 0.8
        }
      ])
      .mockResolvedValueOnce([]);
    listTagLinksForArticleMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ tagId: 'tag-1', source: 'manual', confidence: 0.8 }]);

    const response = await POST(createEvent({ action: 'accept', suggestionId: 'suggestion-1' }));

    expect(response.status).toBe(200);
    expect(attachTagToArticleMock).toHaveBeenCalledWith(expect.anything(), 'admin', {
      articleId: 'article-1',
      tagId: 'tag-1',
      source: 'manual',
      confidence: 0.8
    });
    expect(enqueueScoreJobMock).toHaveBeenCalledWith(expect.anything(), 'article-1');
  });

  it('does not queue rescoring when dismissing a suggestion', async () => {
    listTagSuggestionsForArticleMock
      .mockResolvedValueOnce([
        {
          id: 'suggestion-1',
          name: 'AI Policy',
          name_normalized: 'ai policy',
          confidence: 0.8
        }
      ])
      .mockResolvedValueOnce([]);

    const response = await POST(createEvent({ action: 'dismiss', suggestionId: 'suggestion-1' }));

    expect(response.status).toBe(200);
    expect(dismissTagSuggestionMock).toHaveBeenCalledWith(expect.anything(), 'admin', 'article-1', 'AI Policy');
    expect(enqueueScoreJobMock).not.toHaveBeenCalled();
  });
});
