import { describe, it, expect } from 'vitest';
import { escalatedProvider, backoffMs } from '../retry-empty-articles';

describe('escalatedProvider', () => {
  it('flips Steel to Browserless on low-quality outcomes', () => {
    expect(escalatedProvider('steel')).toBe('browserless');
  });

  it('flips Browserless to Steel on low-quality outcomes', () => {
    expect(escalatedProvider('browserless')).toBe('steel');
  });

  it('returns null for unknown or first-attempt cases', () => {
    expect(escalatedProvider(null)).toBeNull();
    expect(escalatedProvider('readability')).toBeNull();
    expect(escalatedProvider('parse_failed')).toBeNull();
    expect(escalatedProvider('no_readable_content')).toBeNull();
    expect(escalatedProvider('unsupported_content_type')).toBeNull();
  });
});

describe('backoffMs', () => {
  it('starts at 15 minutes for the first retry', () => {
    expect(backoffMs(1)).toBe(15 * 60 * 1000);
  });

  it('doubles each attempt up through the budget', () => {
    expect(backoffMs(2)).toBe(30 * 60 * 1000);
    expect(backoffMs(3)).toBe(60 * 60 * 1000);
    expect(backoffMs(4)).toBe(120 * 60 * 1000);
    expect(backoffMs(5)).toBe(240 * 60 * 1000);
  });

  it('caps at 24h for safety beyond the configured budget', () => {
    // 15 * 2^7 = 1920m which is larger than the 24h cap (1440m).
    expect(backoffMs(8)).toBe(24 * 60 * 60 * 1000);
    expect(backoffMs(20)).toBe(24 * 60 * 60 * 1000);
  });
});
