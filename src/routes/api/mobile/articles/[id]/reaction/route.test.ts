import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireMobileAccessMock = vi.hoisted(() => vi.fn(async () => ({ token: { scope: 'app:read app:write', client_id: 'test', user_id: 'test-user' }, user: { id: 'test-user', role: 'admin' } })));
const dbGetMock = vi.hoisted(() => vi.fn());
const dbRunMock = vi.hoisted(() => vi.fn(async () => undefined));
const nowMock = vi.hoisted(() => vi.fn(() => 1234));
const getPreferredSourceForArticleMock = vi.hoisted(() => vi.fn(async () => ({ feedId: 'feed-1' })));
const isFeedLinkedToArticleMock = vi.hoisted(() => vi.fn(async () => false));
const replaceReactionReasonCodesMock = vi.hoisted(() => vi.fn(async () => undefined));
const processReactionLearningMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('$lib/server/mobile/auth', () => ({
  requireMobileAccess: requireMobileAccessMock
}));

vi.mock('$lib/server/db', () => ({
  dbGet: dbGetMock,
  dbRun: dbRunMock,
  now: nowMock
}));

vi.mock('$lib/server/sources', () => ({
  getPreferredSourceForArticle: getPreferredSourceForArticleMock,
  isFeedLinkedToArticle: isFeedLinkedToArticleMock
}));

vi.mock('$lib/server/reactions', () => ({
  replaceReactionReasonCodes: replaceReactionReasonCodesMock
}));

vi.mock('$lib/server/scoring/learning', () => ({
  processReactionLearning: processReactionLearningMock
}));

import { POST } from './+server';

const createEvent = (body: Record<string, unknown>) =>
  ({
    params: { id: 'article-1' },
    request: new Request('https://api.example.com/api/mobile/articles/article-1/reaction', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer mobile-token' },
      body: JSON.stringify(body)
    }),
    platform: {
      env: {
        DB: {} as D1Database
      }
    } as App.Platform
  }) as Parameters<typeof POST>[0];

describe('/api/mobile/articles/[id]/reaction POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nowMock.mockReturnValue(1234);
    getPreferredSourceForArticleMock.mockResolvedValue({ feedId: 'feed-1' });
    isFeedLinkedToArticleMock.mockResolvedValue(false);
  });

  it('saves canonical reason codes and applies learning for new reactions', async () => {
    dbGetMock.mockResolvedValueOnce(null);

    const response = await POST(
      createEvent({
        value: 1,
        reasonCodes: ['up_good_depth', 'up_interest_match', 'up_good_depth']
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(requireMobileAccessMock).toHaveBeenCalledWith(expect.any(Request), expect.anything(), expect.anything(), 'app:write');
    expect(replaceReactionReasonCodesMock).toHaveBeenCalledWith(expect.anything(), 'test-user', 'article-1', ['up_interest_match', 'up_good_depth'], 1234);
    expect(processReactionLearningMock).toHaveBeenCalledWith(expect.anything(), 'article-1', 1, [
      'up_interest_match',
      'up_good_depth'
    ]);
    expect(payload.reaction).toEqual({
      article_id: 'article-1',
      feed_id: 'feed-1',
      value: 1,
      created_at: 1234,
      reason_codes: ['up_interest_match', 'up_good_depth']
    });
  });

  it('updates reasons without reapplying learning when the value is unchanged', async () => {
    dbGetMock.mockResolvedValueOnce({ value: -1 });

    const response = await POST(
      createEvent({
        value: -1,
        reasonCodes: ['down_stale', 'down_too_shallow']
      })
    );

    expect(response.status).toBe(200);
    expect(replaceReactionReasonCodesMock).toHaveBeenCalledWith(expect.anything(), 'test-user', 'article-1', [
      'down_stale',
      'down_too_shallow'
    ], 1234);
    expect(processReactionLearningMock).not.toHaveBeenCalled();
  });
});
