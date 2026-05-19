import { describe, it, expect } from 'vitest';
import { canonicalizeUrl } from '../canonical-url';

describe('canonicalizeUrl', () => {
  it('strips utm_* tracking params', () => {
    expect(canonicalizeUrl('https://example.com/post?utm_source=newsletter&utm_medium=email&a=keep'))
      .toBe('https://example.com/post?a=keep');
  });

  it('strips utm_* even when alone', () => {
    expect(canonicalizeUrl('https://example.com/post?utm_source=x'))
      .toBe('https://example.com/post');
  });

  it('strips fbclid, gclid, mc_cid, mc_eid, ref, ref_src, s, igshid, _ga', () => {
    expect(canonicalizeUrl('https://example.com/post?fbclid=abc&gclid=def&ref=twitter&s=09'))
      .toBe('https://example.com/post');
  });

  it('drops www. host prefix', () => {
    expect(canonicalizeUrl('https://www.example.com/post'))
      .toBe('https://example.com/post');
  });

  it('normalizes http to https', () => {
    expect(canonicalizeUrl('http://example.com/post'))
      .toBe('https://example.com/post');
  });

  it('drops URL fragment', () => {
    expect(canonicalizeUrl('https://example.com/post#section-2'))
      .toBe('https://example.com/post');
  });

  it('drops trailing slash from path (but not root)', () => {
    expect(canonicalizeUrl('https://example.com/post/'))
      .toBe('https://example.com/post');
    expect(canonicalizeUrl('https://example.com/'))
      .toBe('https://example.com/');
  });

  it('sorts query params alphabetically for order-independence', () => {
    expect(canonicalizeUrl('https://example.com/post?b=2&a=1'))
      .toBe(canonicalizeUrl('https://example.com/post?a=1&b=2'));
  });

  it('returns a low-effort fallback for non-URL inputs like mid:<id>', () => {
    expect(canonicalizeUrl('mid:Stratechery-Test-001@email.stratechery.com'))
      .toBe('mid:stratechery-test-001@email.stratechery.com');
  });

  it('is idempotent', () => {
    const inputs = [
      'https://www.example.com/post/?utm_source=x&b=2&a=1',
      'http://EXAMPLE.com/post#anchor',
      'mid:foo@bar',
      'https://example.com/',
    ];
    for (const input of inputs) {
      const once = canonicalizeUrl(input);
      const twice = canonicalizeUrl(once);
      expect(twice).toBe(once);
    }
  });

  it('handles empty string', () => {
    expect(canonicalizeUrl('')).toBe('');
  });

  it('clusters two equivalent URLs to the same value', () => {
    const a = canonicalizeUrl('https://www.example.com/breaking-news?utm_source=feed1');
    const b = canonicalizeUrl('http://example.com/breaking-news/?utm_medium=email#top');
    expect(a).toBe(b);
  });
});
