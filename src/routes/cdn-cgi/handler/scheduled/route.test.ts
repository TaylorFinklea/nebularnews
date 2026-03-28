import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './+server';
import { runScheduledTasks } from '$lib/server/scheduler';

vi.mock('$lib/server/scheduler', () => ({
  runScheduledTasks: vi.fn(async () => ({
    cron: null,
    runtime: {
      ok: true,
      stage: 'development',
      warnings: [],
      errors: []
    },
    scheduler: null,
    triggered: {
      jobs: true,
      poll: true,
      retention: false
    },
    jobs: null,
    poll: null,
    retention: null,
    skipped: null
  }))
}));

const createEvent = (url: string, appEnv = 'development') =>
  ({
    request: new Request(url),
    url: new URL(url),
    locals: { db: {} },
    platform: {
      env: {
        APP_ENV: appEnv
      }
    } as App.Platform
  }) as Parameters<typeof GET>[0];

describe('/cdn-cgi/handler/scheduled GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects non-development requests', async () => {
    const response = await GET(createEvent('http://localhost/cdn-cgi/handler/scheduled', 'production'));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: 'Dev scheduled handler is only available in development'
    });
    expect(runScheduledTasks).not.toHaveBeenCalled();
  });

  it('rejects invalid modes', async () => {
    const response = await GET(createEvent('http://localhost/cdn-cgi/handler/scheduled?mode=wat'));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid mode. Use all, jobs, poll, or retention.'
    });
    expect(runScheduledTasks).not.toHaveBeenCalled();
  });

  it('runs jobs and poll by default in development', async () => {
    const response = await GET(createEvent('http://localhost/cdn-cgi/handler/scheduled'));

    expect(response.status).toBe(200);
    expect(runScheduledTasks).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ APP_ENV: 'development' }),
      {
        cron: null,
        runJobs: true,
        runPoll: true,
        runRetention: false
      }
    );
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: expect.objectContaining({
        triggered: {
          jobs: true,
          poll: true,
          retention: false
        }
      })
    });
  });

  it('passes cron through without forcing modes', async () => {
    const response = await GET(createEvent('http://localhost/cdn-cgi/handler/scheduled?cron=*/5%20*%20*%20*%20*'));

    expect(response.status).toBe(200);
    expect(runScheduledTasks).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ APP_ENV: 'development' }),
      {
        cron: '*/5 * * * *',
        runJobs: undefined,
        runPoll: undefined,
        runRetention: undefined
      }
    );
  });
});
