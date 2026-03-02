import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbGetMock = vi.hoisted(() => vi.fn());
const dbRunMock = vi.hoisted(() => vi.fn(async () => undefined));
const nowMock = vi.hoisted(() => vi.fn(() => 1234));
const getPreferredSourceForArticleMock = vi.hoisted(() => vi.fn(async () => ({ feedId: 'feed-1' })));
const isFeedLinkedToArticleMock = vi.hoisted(() => vi.fn(async () => false));
const logInfoMock = vi.hoisted(() => vi.fn());
const processReactionLearningMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('$lib/server/db', () => ({
  dbGet: dbGetMock,
  dbRun: dbRunMock,
  now: nowMock
}));

vi.mock('$lib/server/sources', () => ({
  getPreferredSourceForArticle: getPreferredSourceForArticleMock,
  isFeedLinkedToArticle: isFeedLinkedToArticleMock
}));

vi.mock('$lib/server/log', () => ({
  logInfo: logInfoMock
}));

vi.mock('$lib/server/scoring/learning', () => ({
  processReactionLearning: processReactionLearningMock
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
import { processReactionLearning } from '$lib/server/scoring/learning';

const createEvent = (value: 1 | -1) =>
  ({
    params: { id: 'article-1' },
    request: new Request('https://example.com/api/articles/article-1/reaction', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value })
    }),
    platform: {
      env: {
        DB: {} as D1Database
      }
    } as App.Platform,
    locals: { requestId: 'req-test' }
  }) as Parameters<typeof POST>[0];

describe('/api/articles/[id]/reaction POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nowMock.mockReturnValue(1234);
    getPreferredSourceForArticleMock.mockResolvedValue({ feedId: 'feed-1' });
    isFeedLinkedToArticleMock.mockResolvedValue(false);
  });

  it('applies learning for a new reaction', async () => {
    dbGetMock.mockResolvedValueOnce(null);

    const response = await POST(createEvent(1));

    expect(response.status).toBe(200);
    expect(processReactionLearning).toHaveBeenCalledWith(expect.anything(), 'article-1', 1);
  });

  it('skips learning when the stored reaction is unchanged', async () => {
    dbGetMock.mockResolvedValueOnce({ value: 1 });

    const response = await POST(createEvent(1));

    expect(response.status).toBe(200);
    expect(processReactionLearning).not.toHaveBeenCalled();
  });

  it('applies learning when the reaction changes', async () => {
    dbGetMock.mockResolvedValueOnce({ value: 1 });

    const response = await POST(createEvent(-1));

    expect(response.status).toBe(200);
    expect(processReactionLearning).toHaveBeenCalledWith(expect.anything(), 'article-1', -1);
  });
});
