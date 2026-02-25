import { describe, expect, it } from 'vitest';
import {
  clampInitialFeedLookbackDays,
  clampRetentionDays,
  clampDashboardTopRatedCutoff,
  clampDashboardTopRatedLimit,
  clampSchedulerJobsIntervalMinutes,
  clampSchedulerPollIntervalMinutes,
  clampSchedulerPullSlicesPerTick,
  clampSchedulerPullSliceBudgetMs,
  clampSchedulerJobBudgetIdleMs,
  clampSchedulerJobBudgetWhilePullMs,
  intervalMinutesToCronExpression,
  parseBooleanSetting,
  DEFAULT_INITIAL_FEED_LOOKBACK_DAYS,
  DEFAULT_RETENTION_DAYS,
  DEFAULT_DASHBOARD_TOP_RATED_CUTOFF,
  DEFAULT_DASHBOARD_TOP_RATED_LIMIT,
  DEFAULT_SCHEDULER_JOBS_INTERVAL_MIN,
  DEFAULT_SCHEDULER_POLL_INTERVAL_MIN,
  DEFAULT_SCHEDULER_PULL_SLICES_PER_TICK,
  DEFAULT_SCHEDULER_PULL_SLICE_BUDGET_MS,
  DEFAULT_SCHEDULER_JOB_BUDGET_IDLE_MS,
  DEFAULT_SCHEDULER_JOB_BUDGET_WHILE_PULL_MS
} from './settings';

describe('dashboard top-rated settings', () => {
  it('clamps cutoff into supported 1-5 range', () => {
    expect(clampDashboardTopRatedCutoff(0)).toBe(1);
    expect(clampDashboardTopRatedCutoff(6)).toBe(5);
    expect(clampDashboardTopRatedCutoff(4)).toBe(4);
  });

  it('falls back to default cutoff for invalid values', () => {
    expect(clampDashboardTopRatedCutoff('bad')).toBe(DEFAULT_DASHBOARD_TOP_RATED_CUTOFF);
  });

  it('clamps top-rated limit into supported range', () => {
    expect(clampDashboardTopRatedLimit(0)).toBe(1);
    expect(clampDashboardTopRatedLimit(99)).toBe(20);
    expect(clampDashboardTopRatedLimit(8)).toBe(8);
  });

  it('falls back to default limit for invalid values', () => {
    expect(clampDashboardTopRatedLimit('bad')).toBe(DEFAULT_DASHBOARD_TOP_RATED_LIMIT);
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
