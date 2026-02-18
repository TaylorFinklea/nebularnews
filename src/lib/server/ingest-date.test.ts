import { describe, expect, it } from 'vitest';
import { normalizePublishedAt, shouldAutoQueueArticleJobs, shouldIngestItemForInitialLookback } from './ingest';

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

describe('shouldIngestItemForInitialLookback', () => {
  it('keeps recent items within lookback window', () => {
    const referenceAt = Date.UTC(2026, 1, 18, 12, 0, 0);
    const publishedAt = Date.UTC(2026, 1, 1, 12, 0, 0);
    expect(shouldIngestItemForInitialLookback(publishedAt, referenceAt, 45)).toBe(true);
  });

  it('filters items older than lookback window', () => {
    const referenceAt = Date.UTC(2026, 1, 18, 12, 0, 0);
    const publishedAt = Date.UTC(2025, 10, 1, 12, 0, 0);
    expect(shouldIngestItemForInitialLookback(publishedAt, referenceAt, 45)).toBe(false);
  });

  it('keeps items with missing published date', () => {
    const referenceAt = Date.UTC(2026, 1, 18, 12, 0, 0);
    expect(shouldIngestItemForInitialLookback(null, referenceAt, 45)).toBe(true);
  });
});
