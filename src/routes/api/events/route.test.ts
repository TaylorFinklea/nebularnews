import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbGetMock = vi.hoisted(() => vi.fn());
const getManualPullStateMock = vi.hoisted(() => vi.fn());
const isEventsV2EnabledMock = vi.hoisted(() => vi.fn());
const getEventsPollMsMock = vi.hoisted(() => vi.fn());
const logInfoMock = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/db', () => ({
  dbGet: dbGetMock
}));

vi.mock('$lib/server/manual-pull', () => ({
  getManualPullState: getManualPullStateMock
}));

vi.mock('$lib/server/flags', () => ({
  isEventsV2Enabled: isEventsV2EnabledMock
}));

vi.mock('$lib/server/settings', () => ({
  getEventsPollMs: getEventsPollMsMock
}));

vi.mock('$lib/server/log', () => ({
  logInfo: logInfoMock
}));

import { GET } from './+server';

describe('/api/events GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isEventsV2EnabledMock.mockReturnValue(true);
    getEventsPollMsMock.mockResolvedValue(5000);
    getManualPullStateMock.mockResolvedValue({
      runId: null,
      status: 'idle',
      inProgress: false,
      startedAt: null,
      completedAt: null,
      lastRunStatus: null,
      lastError: null
    });
  });

  it('does not crash when the request aborts while a snapshot is still in flight', async () => {
    let resolveCounts: ((value: { pending: number; running: number; failed: number; done: number }) => void) | null =
      null;
    dbGetMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCounts = resolve;
        })
    );

    const controller = new AbortController();
    const response = await GET({
      platform: {
        env: {
          DB: {} as D1Database
        }
      } as App.Platform,
      request: new Request('https://example.com/api/events', {
        signal: controller.signal
      })
    } as Parameters<typeof GET>[0]);

    expect(response.headers.get('content-type')).toContain('text/event-stream');

    controller.abort();
    resolveCounts?.({ pending: 0, running: 0, failed: 0, done: 0 });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(logInfoMock).not.toHaveBeenCalledWith(
      'events.stream.closed',
      expect.objectContaining({
        avg_tick_ms: expect.any(Number)
      })
    );
  });
});
