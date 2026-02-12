import { describe, expect, it } from 'vitest';
import { normalizeUrl } from './urls';

describe('normalizeUrl', () => {
  it('strips tracking params', () => {
    const input = 'https://example.com/article?utm_source=foo&gclid=bar&id=1';
    expect(normalizeUrl(input)).toBe('https://example.com/article?id=1');
  });

  it('removes hash', () => {
    const input = 'https://example.com/post#section';
    expect(normalizeUrl(input)).toBe('https://example.com/post');
  });
});
