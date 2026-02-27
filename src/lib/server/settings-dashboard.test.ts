import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbGetMock = vi.hoisted(() => vi.fn());

vi.mock('./db', () => ({
  dbGet: dbGetMock,
  dbAll: vi.fn(),
  dbRun: vi.fn()
}));

import {
  clampInitialFeedLookbackDays,
  clampRetentionDays,
  clampDashboardTopRatedCutoff,
  clampDashboardTopRatedLimit,
  clampDashboardQueueWindowDays,
  clampDashboardQueueLimit,
  clampDashboardQueueScoreCutoff,
  clampSchedulerJobsIntervalMinutes,
  clampSchedulerPollIntervalMinutes,
  clampSchedulerPullSlicesPerTick,
  clampSchedulerPullSliceBudgetMs,
  clampSchedulerJobBudgetIdleMs,
  clampSchedulerJobBudgetWhilePullMs,
  clampAutoTagMaxPerArticle,
  intervalMinutesToCronExpression,
  parseBooleanSetting,
  getDashboardQueueConfig,
  DEFAULT_INITIAL_FEED_LOOKBACK_DAYS,
  DEFAULT_RETENTION_DAYS,
  DEFAULT_DASHBOARD_TOP_RATED_CUTOFF,
  DEFAULT_DASHBOARD_TOP_RATED_LIMIT,
  DEFAULT_DASHBOARD_QUEUE_WINDOW_DAYS,
  DEFAULT_DASHBOARD_QUEUE_LIMIT,
  DEFAULT_DASHBOARD_QUEUE_SCORE_CUTOFF,
  DEFAULT_SCHEDULER_JOBS_INTERVAL_MIN,
  DEFAULT_SCHEDULER_POLL_INTERVAL_MIN,
  DEFAULT_SCHEDULER_PULL_SLICES_PER_TICK,
  DEFAULT_SCHEDULER_PULL_SLICE_BUDGET_MS,
  DEFAULT_SCHEDULER_JOB_BUDGET_IDLE_MS,
  DEFAULT_SCHEDULER_JOB_BUDGET_WHILE_PULL_MS,
  DEFAULT_AUTO_TAG_MAX_PER_ARTICLE
} from './settings';

const mockSettings = (values: Record<string, string | number | null | undefined>) => {
  dbGetMock.mockImplementation(async (_db: unknown, sql: string, params: unknown[]) => {
    if (!sql.includes('SELECT value FROM settings WHERE key = ?')) return null;
    const key = String(params?.[0] ?? '');
    const value = values[key];
    if (value === undefined || value === null) return null;
    return { value: String(value) };
  });
};

describe('dashboard and scheduler settings', () => {
  beforeEach(() => {
    dbGetMock.mockReset();
    mockSettings({});
  });

  it('clamps legacy top-rated cutoff into supported 1-5 range', () => {
    expect(clampDashboardTopRatedCutoff(0)).toBe(1);
    expect(clampDashboardTopRatedCutoff(6)).toBe(5);
    expect(clampDashboardTopRatedCutoff(4)).toBe(4);
  });

  it('falls back to default legacy top-rated cutoff for invalid values', () => {
    expect(clampDashboardTopRatedCutoff('bad')).toBe(DEFAULT_DASHBOARD_TOP_RATED_CUTOFF);
  });

  it('clamps legacy top-rated limit into supported range', () => {
    expect(clampDashboardTopRatedLimit(0)).toBe(1);
    expect(clampDashboardTopRatedLimit(99)).toBe(20);
    expect(clampDashboardTopRatedLimit(8)).toBe(8);
  });

  it('falls back to default legacy top-rated limit for invalid values', () => {
    expect(clampDashboardTopRatedLimit('bad')).toBe(DEFAULT_DASHBOARD_TOP_RATED_LIMIT);
  });

  it('clamps dashboard queue settings into supported ranges', () => {
    expect(clampDashboardQueueWindowDays(0)).toBe(1);
    expect(clampDashboardQueueWindowDays(99)).toBe(30);
    expect(clampDashboardQueueWindowDays(14)).toBe(14);

    expect(clampDashboardQueueLimit(0)).toBe(1);
    expect(clampDashboardQueueLimit(99)).toBe(20);
    expect(clampDashboardQueueLimit(8)).toBe(8);

    expect(clampDashboardQueueScoreCutoff(0)).toBe(1);
    expect(clampDashboardQueueScoreCutoff(9)).toBe(5);
    expect(clampDashboardQueueScoreCutoff(4)).toBe(4);
  });

  it('falls back to queue defaults for invalid queue values', () => {
    expect(clampDashboardQueueWindowDays('bad')).toBe(DEFAULT_DASHBOARD_QUEUE_WINDOW_DAYS);
    expect(clampDashboardQueueLimit('bad')).toBe(DEFAULT_DASHBOARD_QUEUE_LIMIT);
    expect(clampDashboardQueueScoreCutoff('bad')).toBe(DEFAULT_DASHBOARD_QUEUE_SCORE_CUTOFF);
  });

  it('uses legacy top-rated keys when queue keys are absent', async () => {
    mockSettings({
      dashboard_top_rated_limit: 9,
      dashboard_top_rated_cutoff: 4
    });

    const config = await getDashboardQueueConfig({} as D1Database);
    expect(config).toEqual({
      windowDays: DEFAULT_DASHBOARD_QUEUE_WINDOW_DAYS,
      limit: 9,
      scoreCutoff: 4
    });
  });

  it('prefers queue keys over legacy top-rated keys when both exist', async () => {
    mockSettings({
      dashboard_queue_window_days: 14,
      dashboard_queue_limit: 12,
      dashboard_queue_score_cutoff: 5,
      dashboard_top_rated_limit: 2,
      dashboard_top_rated_cutoff: 1
    });

    const config = await getDashboardQueueConfig({} as D1Database);
    expect(config).toEqual({
      windowDays: 14,
      limit: 12,
      scoreCutoff: 5
    });
  });

  it('clamps initial feed lookback days into supported range', () => {
    expect(clampInitialFeedLookbackDays(-1)).toBe(0);
    expect(clampInitialFeedLookbackDays(8000)).toBe(3650);
    expect(clampInitialFeedLookbackDays(45)).toBe(45);
  });

  it('falls back to default initial lookback days for invalid values', () => {
    expect(clampInitialFeedLookbackDays('bad')).toBe(DEFAULT_INITIAL_FEED_LOOKBACK_DAYS);
  });

  it('clamps retention days into supported range', () => {
    expect(clampRetentionDays(-1)).toBe(0);
    expect(clampRetentionDays(99999)).toBe(3650);
    expect(clampRetentionDays(30)).toBe(30);
  });

  it('falls back to default retention days for invalid values', () => {
    expect(clampRetentionDays('bad')).toBe(DEFAULT_RETENTION_DAYS);
  });

  it('clamps scheduler interval settings', () => {
    expect(clampSchedulerJobsIntervalMinutes(0)).toBe(1);
    expect(clampSchedulerJobsIntervalMinutes(45)).toBe(30);
    expect(clampSchedulerJobsIntervalMinutes('bad')).toBe(DEFAULT_SCHEDULER_JOBS_INTERVAL_MIN);
    expect(clampSchedulerPollIntervalMinutes(1)).toBe(5);
    expect(clampSchedulerPollIntervalMinutes(120)).toBe(60);
    expect(clampSchedulerPollIntervalMinutes('bad')).toBe(DEFAULT_SCHEDULER_POLL_INTERVAL_MIN);
  });

  it('clamps scheduler runtime budgets', () => {
    expect(clampSchedulerPullSlicesPerTick(0)).toBe(1);
    expect(clampSchedulerPullSlicesPerTick(8)).toBe(4);
    expect(clampSchedulerPullSlicesPerTick('bad')).toBe(DEFAULT_SCHEDULER_PULL_SLICES_PER_TICK);

    expect(clampSchedulerPullSliceBudgetMs(1000)).toBe(2000);
    expect(clampSchedulerPullSliceBudgetMs(99999)).toBe(20000);
    expect(clampSchedulerPullSliceBudgetMs('bad')).toBe(DEFAULT_SCHEDULER_PULL_SLICE_BUDGET_MS);

    expect(clampSchedulerJobBudgetIdleMs(1000)).toBe(2000);
    expect(clampSchedulerJobBudgetIdleMs(99999)).toBe(20000);
    expect(clampSchedulerJobBudgetIdleMs('bad')).toBe(DEFAULT_SCHEDULER_JOB_BUDGET_IDLE_MS);

    expect(clampSchedulerJobBudgetWhilePullMs(100)).toBe(500);
    expect(clampSchedulerJobBudgetWhilePullMs(20000)).toBe(10000);
    expect(clampSchedulerJobBudgetWhilePullMs('bad')).toBe(DEFAULT_SCHEDULER_JOB_BUDGET_WHILE_PULL_MS);
  });

  it('clamps auto-tag max per article settings', () => {
    expect(clampAutoTagMaxPerArticle(0)).toBe(1);
    expect(clampAutoTagMaxPerArticle(9)).toBe(5);
    expect(clampAutoTagMaxPerArticle(3)).toBe(3);
    expect(clampAutoTagMaxPerArticle('bad')).toBe(DEFAULT_AUTO_TAG_MAX_PER_ARTICLE);
  });

  it('parses scheduler booleans and cron values', () => {
    expect(parseBooleanSetting(true, false)).toBe(true);
    expect(parseBooleanSetting('false', true)).toBe(false);
    expect(parseBooleanSetting('yes', false)).toBe(true);
    expect(parseBooleanSetting('bad', true)).toBe(true);

    expect(intervalMinutesToCronExpression(5)).toBe('*/5 * * * *');
    expect(intervalMinutesToCronExpression(60)).toBe('0 * * * *');
    expect(intervalMinutesToCronExpression(90)).toBe('0 * * * *');
  });
});
