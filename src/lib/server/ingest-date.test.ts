import { describe, expect, it } from 'vitest';
import { normalizePublishedAt } from './ingest';

describe('normalizePublishedAt', () => {
  it('keeps normal published dates', () => {
    const base = 1_000_000;
    expect(normalizePublishedAt(base - 5_000, base)).toBe(base - 5_000);
  });

  it('clamps far-future dates to fallback timestamp', () => {
    const base = 1_000_000;
    const twoDays = 1000 * 60 * 60 * 48;
    expect(normalizePublishedAt(base + twoDays, base)).toBe(base);
  });

  it('returns null when published date is missing', () => {
    expect(normalizePublishedAt(null, 1_000_000)).toBeNull();
  });
});
