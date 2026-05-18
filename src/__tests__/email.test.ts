import { describe, it, expect } from 'vitest';
import { shouldQuarantine, emailCanonicalUrl } from '../email';

describe('shouldQuarantine', () => {
  it('returns false when expected is null (TOFU lock pending)', () => {
    expect(shouldQuarantine(null, 'sender@example.com')).toBe(false);
  });

  it('returns false when expected matches actual', () => {
    expect(shouldQuarantine('sender@example.com', 'sender@example.com')).toBe(false);
  });

  it('returns false when comparison is case-insensitive', () => {
    expect(shouldQuarantine('Sender@Example.COM', 'sender@example.com')).toBe(false);
    expect(shouldQuarantine('sender@example.com', 'Sender@Example.COM')).toBe(false);
  });

  it('returns true when expected differs from actual', () => {
    expect(shouldQuarantine('alice@example.com', 'bob@example.com')).toBe(true);
  });

  it('returns true when actual is empty but expected is set', () => {
    expect(shouldQuarantine('alice@example.com', '')).toBe(true);
  });
});

describe('emailCanonicalUrl', () => {
  it('returns mid:<id> when Message-Id is provided', async () => {
    const url = await emailCanonicalUrl('abc-123@example.com', 'body content');
    expect(url).toBe('mid:abc-123@example.com');
  });

  it('hashes body when Message-Id is null', async () => {
    const url = await emailCanonicalUrl(null, 'some body content');
    expect(url).toMatch(/^mid:hash-[a-f0-9]{16,}$/);
  });

  it('produces stable hashes for identical bodies', async () => {
    const a = await emailCanonicalUrl(null, 'identical body');
    const b = await emailCanonicalUrl(null, 'identical body');
    expect(a).toBe(b);
  });

  it('produces different hashes for different bodies', async () => {
    const a = await emailCanonicalUrl(null, 'body one');
    const b = await emailCanonicalUrl(null, 'body two');
    expect(a).not.toBe(b);
  });

  it('handles empty body when no Message-Id', async () => {
    const url = await emailCanonicalUrl(null, '');
    expect(url).toMatch(/^mid:hash-[a-f0-9]{16,}$/);
  });
});
