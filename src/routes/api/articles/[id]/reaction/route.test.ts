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

const createEvent = (body: Record<string, unknown>) =>
  ({
    params: { id: 'article-1' },
    request: new Request('https://example.com/api/articles/article-1/reaction', {
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

describe('/api/articles/[id]/reaction POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nowMock.mockReturnValue(1234);
    getPreferredSourceForArticleMock.mockResolvedValue({ feedId: 'feed-1' });
    isFeedLinkedToArticleMock.mockResolvedValue(false);
  });

  it('applies learning for a new reaction', async () => {
    dbGetMock.mockResolvedValueOnce(null);

    const response = await POST(createEvent({ value: 1, reasonCodes: ['up_interest_match', 'up_good_depth'] }));
    const payload = (await response.json()) as { data: { reaction: { reason_codes: string[] } } };

    expect(response.status).toBe(200);
    expect(processReactionLearning).toHaveBeenCalledWith(expect.anything(), 'article-1', 1, [
      'up_interest_match',
      'up_good_depth'
    ]);
    expect(payload.data.reaction.reason_codes).toEqual(['up_interest_match', 'up_good_depth']);
    expect(dbRunMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('INSERT INTO article_reaction_reasons'),
      ['article-1', 'admin', 'up_interest_match', 1234]
    );
  });

  it('skips learning when the stored reaction is unchanged', async () => {
    dbGetMock.mockResolvedValueOnce({ value: 1 });

    const response = await POST(createEvent({ value: 1, reasonCodes: ['up_source_trust'] }));

    expect(response.status).toBe(200);
    expect(processReactionLearning).not.toHaveBeenCalled();
  });

  it('applies learning when the reaction changes', async () => {
    dbGetMock.mockResolvedValueOnce({ value: 1 });

    const response = await POST(createEvent({ value: -1, reasonCodes: ['down_stale', 'down_too_shallow'] }));

    expect(response.status).toBe(200);
    expect(processReactionLearning).toHaveBeenCalledWith(expect.anything(), 'article-1', -1, [
      'down_stale',
      'down_too_shallow'
    ]);
  });

  it('dedupes duplicate reason codes and stores them in canonical order', async () => {
    dbGetMock.mockResolvedValueOnce(null);

    const response = await POST(
      createEvent({
        value: 1,
        reasonCodes: ['up_good_depth', 'up_interest_match', 'up_good_depth', 'up_source_trust']
      })
    );
    const payload = (await response.json()) as { data: { reaction: { reason_codes: string[] } } };

    expect(response.status).toBe(200);
    expect(payload.data.reaction.reason_codes).toEqual([
      'up_interest_match',
      'up_source_trust',
      'up_good_depth'
    ]);
  });

  it('rejects invalid reason codes', async () => {
    const response = await POST(createEvent({ value: 1, reasonCodes: ['invalid_reason'] }));

    expect(response.status).toBe(400);
    expect(dbRunMock).not.toHaveBeenCalled();
    expect(processReactionLearning).not.toHaveBeenCalled();
  });

  it('rejects reason codes from the wrong reaction direction', async () => {
    const response = await POST(createEvent({ value: 1, reasonCodes: ['down_stale'] }));

    expect(response.status).toBe(400);
    expect(dbRunMock).not.toHaveBeenCalled();
    expect(processReactionLearning).not.toHaveBeenCalled();
  });

  it('replaces prior reasons on subsequent saves', async () => {
    dbGetMock.mockResolvedValueOnce({ value: -1 });

    const response = await POST(createEvent({ value: -1, reasonCodes: ['down_off_topic', 'down_stale'] }));

    expect(response.status).toBe(200);
    expect(dbRunMock).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      'DELETE FROM article_reaction_reasons WHERE article_id = ? AND user_id = ?',
      ['article-1', 'admin']
    );
    expect(dbRunMock).toHaveBeenNthCalledWith(
      3,
      expect.anything(),
      expect.stringContaining('INSERT INTO article_reaction_reasons'),
      ['article-1', 'admin', 'down_off_topic', 1234]
    );
    expect(dbRunMock).toHaveBeenNthCalledWith(
      4,
      expect.anything(),
      expect.stringContaining('INSERT INTO article_reaction_reasons'),
      ['article-1', 'admin', 'down_stale', 1234]
    );
  });

  it('does not apply learning when only reasons change for the same reaction value', async () => {
    dbGetMock.mockResolvedValueOnce({ value: 1 });

    const response = await POST(createEvent({ value: 1, reasonCodes: ['up_author_like'] }));

    expect(response.status).toBe(200);
    expect(processReactionLearning).not.toHaveBeenCalled();
    expect(dbRunMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('INSERT INTO article_reaction_reasons'),
      ['article-1', 'admin', 'up_author_like', 1234]
    );
  });
});
