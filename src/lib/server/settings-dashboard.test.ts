import { describe, expect, it } from 'vitest';
import {
  clampDashboardTopRatedCutoff,
  clampDashboardTopRatedLimit,
  DEFAULT_DASHBOARD_TOP_RATED_CUTOFF,
  DEFAULT_DASHBOARD_TOP_RATED_LIMIT
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
});
