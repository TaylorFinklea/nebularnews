import { describe, expect, it } from 'vitest';
import { normalizePublishedAt, shouldAutoQueueArticleJobs } from './ingest';

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

describe('shouldAutoQueueArticleJobs', () => {
  it('returns true for an article published today (UTC)', () => {
    const fetchedAt = Date.UTC(2026, 1, 13, 14, 30, 0);
    const publishedAt = Date.UTC(2026, 1, 13, 2, 0, 0);
    expect(shouldAutoQueueArticleJobs(publishedAt, fetchedAt)).toBe(true);
  });

  it('returns false for an article published on a previous UTC day', () => {
    const fetchedAt = Date.UTC(2026, 1, 13, 14, 30, 0);
    const publishedAt = Date.UTC(2026, 1, 12, 23, 59, 59);
    expect(shouldAutoQueueArticleJobs(publishedAt, fetchedAt)).toBe(false);
  });

  it('uses fetched timestamp when published date is missing', () => {
    const fetchedAt = Date.UTC(2026, 1, 13, 14, 30, 0);
    expect(shouldAutoQueueArticleJobs(null, fetchedAt)).toBe(true);
  });
});
