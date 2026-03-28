import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbGetMock = vi.hoisted(() => vi.fn());
const listTagLinksForArticleMock = vi.hoisted(() => vi.fn());
const listTagsForArticleMock = vi.hoisted(() => vi.fn());
const resolveTagsByTokensMock = vi.hoisted(() => vi.fn());
const ensureTagByNameMock = vi.hoisted(() => vi.fn());
const attachTagToArticleMock = vi.hoisted(() => vi.fn(async () => undefined));
const detachTagFromArticleMock = vi.hoisted(() => vi.fn(async () => undefined));
const enqueueScoreJobMock = vi.hoisted(() => vi.fn(async () => undefined));
const logInfoMock = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/db', () => ({
  dbGet: dbGetMock
}));

vi.mock('$lib/server/tags', () => ({
  attachTagToArticle: attachTagToArticleMock,
  ensureTagByName: ensureTagByNameMock,
  detachTagFromArticle: detachTagFromArticleMock,
  listTagLinksForArticle: listTagLinksForArticleMock,
  listTagsForArticle: listTagsForArticleMock,
  resolveTagsByTokens: resolveTagsByTokensMock,
  serializeArticleTagLinkState: (links: Array<{ tagId: string; source: string; confidence: number | null }>) =>
    [...links]
      .map((link) => `${link.tagId}:${link.source}:${link.confidence === null ? 'null' : Number(link.confidence).toFixed(3)}`)
      .sort()
      .join('|')
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

vi.mock('$lib/server/job-queue', () => ({
  enqueueScoreJob: enqueueScoreJobMock
}));

vi.mock('$lib/server/log', () => ({
  logInfo: logInfoMock
}));

import { POST } from './+server';

const createEvent = (body: Record<string, unknown>) =>
  ({
    params: { id: 'article-1' },
    request: new Request('https://example.com/api/articles/article-1/tags', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }),
    platform: {} as App.Platform,
    locals: { db: {} as any, requestId: 'req-1', user: { id: 'admin', role: 'admin' } }
  }) as unknown as Parameters<typeof POST>[0];

describe('/api/articles/[id]/tags POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbGetMock.mockResolvedValue({ id: 'article-1' });
    listTagsForArticleMock.mockResolvedValue([]);
    ensureTagByNameMock.mockResolvedValue({ id: 'tag-created' });
  });

  it('queues rescoring when the article tag state changes', async () => {
    resolveTagsByTokensMock
      .mockResolvedValueOnce([{ id: 'tag-1' }])
      .mockResolvedValueOnce([]);
    listTagLinksForArticleMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ tagId: 'tag-1', source: 'manual', confidence: null }]);

    const response = await POST(createEvent({ addTagIds: ['tag-1'] }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(attachTagToArticleMock).toHaveBeenCalledWith(expect.anything(), 'admin', {
      articleId: 'article-1',
      tagId: 'tag-1',
      source: 'manual',
      confidence: null
    });
    expect(enqueueScoreJobMock).toHaveBeenCalledWith(expect.anything(), 'article-1');
    expect(payload.ok).toBe(true);
  });

  it('does not queue rescoring when the tag state is unchanged', async () => {
    resolveTagsByTokensMock
      .mockResolvedValueOnce([{ id: 'tag-1' }])
      .mockResolvedValueOnce([]);
    listTagLinksForArticleMock
      .mockResolvedValueOnce([{ tagId: 'tag-1', source: 'manual', confidence: null }])
      .mockResolvedValueOnce([{ tagId: 'tag-1', source: 'manual', confidence: null }]);

    const response = await POST(createEvent({ addTagIds: ['tag-1'] }));

    expect(response.status).toBe(200);
    expect(enqueueScoreJobMock).not.toHaveBeenCalled();
  });
});
