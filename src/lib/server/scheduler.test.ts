import { beforeEach, describe, expect, it, vi } from 'vitest';

const processPullRunsMock = vi.hoisted(() => vi.fn());
const recoverStalePullRunsMock = vi.hoisted(() => vi.fn());
const queueMissingRecentArticleJobsMock = vi.hoisted(() => vi.fn());
const processJobsMock = vi.hoisted(() => vi.fn());
const runNewsBriefSchedulerTickMock = vi.hoisted(() => vi.fn());
const deleteOrphanArticlesBatchMock = vi.hoisted(() => vi.fn());

vi.mock('./ingest', () => ({
  pollFeeds: vi.fn()
}));

vi.mock('./jobs', () => ({
  processJobs: processJobsMock
}));

vi.mock('./manual-pull', () => ({
  processPullRuns: processPullRunsMock,
  recoverStalePullRuns: recoverStalePullRunsMock
}));

vi.mock('./news-brief', () => ({
  runNewsBriefSchedulerTick: runNewsBriefSchedulerTickMock
}));

vi.mock('./push/digest', () => ({
  runNotificationDigest: vi.fn(async () => undefined)
}));

vi.mock('./jobs-admin', () => ({
  queueMissingRecentArticleJobs: queueMissingRecentArticleJobsMock
}));

vi.mock('./migrations', () => ({
  ensureSchema: vi.fn()
}));

vi.mock('./runtime-config', () => ({
  assertRuntimeConfig: vi.fn(() => ({
    ok: true,
    stage: 'development',
    warnings: [],
    errors: []
  }))
}));

vi.mock('./log', () => ({
  logError: vi.fn(),
  logInfo: vi.fn()
}));

vi.mock('./retention', () => ({
  runRetentionCleanup: vi.fn()
}));

vi.mock('./orphan-cleanup', () => ({
  DEFAULT_SCHEDULED_ORPHAN_CLEANUP_LIMIT: 100,
  deleteOrphanArticlesBatch: deleteOrphanArticlesBatchMock
}));

vi.mock('./settings', () => ({
  getSchedulerRuntimeConfig: vi.fn(async () => ({
    jobsIntervalMinutes: 5,
    pollIntervalMinutes: 60,
    pullSlicesPerTick: 1,
    pullSliceBudgetMs: 8000,
    jobBudgetIdleMs: 8000,
    jobBudgetWhilePullMs: 3000,
    autoQueueTodayMissing: true
  })),
  intervalMinutesToCronExpression: vi.fn((minutes: number) => `*/${minutes} * * * *`),
  getNewsBriefConfig: vi.fn(async () => ({
    enabled: false,
    timezone: 'America/Chicago',
    morningTime: '08:00',
    eveningTime: '17:00',
    lookbackHours: 48,
    scoreCutoff: 3
  })),
  getSetting: vi.fn(async () => null),
  setSetting: vi.fn(async () => undefined)
}));

import { runScheduledTasks } from './scheduler';

describe('runScheduledTasks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    processPullRunsMock.mockResolvedValue({
      processed: true,
      durationMs: 1,
      slices: [{ status: 'success', runId: 'pull-1', processedCycles: 1, targetCycles: 1, durationMs: 1 }]
    });
    queueMissingRecentArticleJobsMock.mockResolvedValue({
      windowStart: 1,
      windowEnd: 2,
      lookbackHours: 72,
      scoreQueued: 1,
      autoTagQueued: 1,
      imageBackfillQueued: 1
    });
    processJobsMock.mockResolvedValue({ processed: 1 });
    runNewsBriefSchedulerTickMock.mockResolvedValue({ queued: 0, processed: 0 });
    deleteOrphanArticlesBatchMock.mockResolvedValue({
      targeted: 0,
      deleted_articles: 0,
      orphan_count_after: 0,
      has_more: false
    });
  });

  it('queues recent missing jobs with the fixed 72 hour backstop', async () => {
    const summary = await runScheduledTasks(
      {} as any,
      {} as App.Platform['env'],
      { runJobs: true, runPoll: false, runRetention: false }
    );

    expect(queueMissingRecentArticleJobsMock).toHaveBeenCalledWith(expect.anything(), { lookbackHours: 72 });
    expect(summary.jobs?.queuedRecent).toEqual({
      windowStart: 1,
      windowEnd: 2,
      lookbackHours: 72,
      scoreQueued: 1,
      autoTagQueued: 1,
      imageBackfillQueued: 1
    });
  });

  it('skips the recent missing-job backstop while a pull slice is still running', async () => {
    processPullRunsMock.mockResolvedValueOnce({
      processed: true,
      durationMs: 1,
      slices: [{ status: 'running', runId: 'pull-1', processedCycles: 1, targetCycles: 2, durationMs: 1 }]
    });

    const summary = await runScheduledTasks(
      {} as any,
      {} as App.Platform['env'],
      { runJobs: true, runPoll: false, runRetention: false }
    );

    expect(queueMissingRecentArticleJobsMock).not.toHaveBeenCalled();
    expect(summary.jobs?.queuedRecent).toBeNull();
  });
});
