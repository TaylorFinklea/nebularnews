import { beforeEach, describe, expect, it, vi } from 'vitest';

const enqueueArticleJobMock = vi.hoisted(() => vi.fn(async () => undefined));
const runArticleJobImmediatelyMock = vi.hoisted(() => vi.fn(async () => ({ provider: 'openai', model: 'gpt-5' })));

vi.mock('$lib/server/job-queue', () => ({
  enqueueArticleJob: enqueueArticleJobMock
}));

vi.mock('$lib/server/jobs', () => ({
  runArticleJobImmediately: runArticleJobImmediatelyMock
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
      env: {}
    } as App.Platform,
    locals: {
      db: {} as any,
      requestId: 'req-test',
      user: null
    }
  }) as Parameters<typeof POST>[0];

describe('/api/articles/[id]/rerun POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows deterministic auto-tag reruns even without AI tagging enabled', async () => {
    const response = await POST(createEvent({ types: ['auto_tag', 'score'] }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true, executed: [], queued: ['score', 'auto_tag'] });
    expect(enqueueArticleJobMock).toHaveBeenNthCalledWith(1, expect.anything(), 'score', 'article-1');
    expect(enqueueArticleJobMock).toHaveBeenNthCalledWith(2, expect.anything(), 'auto_tag', 'article-1');
  });

  it('runs summarize immediately and still queues other requested jobs', async () => {
    const response = await POST(createEvent({ types: ['summarize', 'score'] }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true, executed: ['summarize'], queued: ['score'] });
    expect(runArticleJobImmediatelyMock).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'summarize', 'article-1');
    expect(enqueueArticleJobMock).toHaveBeenCalledTimes(1);
    expect(enqueueArticleJobMock).toHaveBeenCalledWith(expect.anything(), 'score', 'article-1');
  });

  it('returns a conflict when the summary job is already running', async () => {
    runArticleJobImmediatelyMock.mockRejectedValueOnce(new Error('Job is currently running'));

    const response = await POST(createEvent({ types: ['summarize'] }));
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload).toEqual({ error: 'Job is currently running' });
    expect(enqueueArticleJobMock).not.toHaveBeenCalled();
  });

  it('rejects invalid job types', async () => {
    const response = await POST(createEvent({ types: ['bogus'] }));

    expect(response.status).toBe(400);
    expect(enqueueArticleJobMock).not.toHaveBeenCalled();
  });
});
