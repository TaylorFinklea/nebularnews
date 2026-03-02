import { beforeEach, describe, expect, it, vi } from 'vitest';

const enqueueArticleJobMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('$lib/server/job-queue', () => ({
  enqueueArticleJob: enqueueArticleJobMock
}));

import { POST } from './+server';

const createEvent = (body: Record<string, unknown>) =>
  ({
    params: { id: 'article-1' },
    request: new Request('https://example.com/api/articles/article-1/rerun', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }),
    platform: {
      env: {
        DB: {} as D1Database
      }
    } as App.Platform
  }) as Parameters<typeof POST>[0];

describe('/api/articles/[id]/rerun POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows deterministic auto-tag reruns even without AI tagging enabled', async () => {
    const response = await POST(createEvent({ types: ['auto_tag', 'score'] }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true, queued: ['auto_tag', 'score'] });
    expect(enqueueArticleJobMock).toHaveBeenNthCalledWith(1, expect.anything(), 'score', 'article-1');
    expect(enqueueArticleJobMock).toHaveBeenNthCalledWith(2, expect.anything(), 'auto_tag', 'article-1');
  });

  it('rejects invalid job types', async () => {
    const response = await POST(createEvent({ types: ['bogus'] }));

    expect(response.status).toBe(400);
    expect(enqueueArticleJobMock).not.toHaveBeenCalled();
  });
});
