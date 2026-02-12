import { describe, expect, it } from 'vitest';
import { clampQueueCycles, normalizeJobFilter } from './jobs-admin';

describe('normalizeJobFilter', () => {
  it('falls back to all for unknown values', () => {
    expect(normalizeJobFilter('wat')).toBe('all');
  });

  it('accepts known values', () => {
    expect(normalizeJobFilter('pending')).toBe('pending');
    expect(normalizeJobFilter('failed')).toBe('failed');
  });
});

describe('clampQueueCycles', () => {
  it('clamps lower bound', () => {
    expect(clampQueueCycles(0)).toBe(1);
  });

  it('clamps upper bound', () => {
    expect(clampQueueCycles(100)).toBe(10);
  });
});
