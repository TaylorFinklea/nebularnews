// src/lib/__tests__/source-detect.test.ts
import { describe, it, expect } from 'vitest';
import { detectSource, expandFetchUrl } from '../source-detect';

describe('detectSource — existing patterns (regression)', () => {
  it('detects subreddit shorthand', () => {
    expect(detectSource('r/birding')).toEqual({
      type: 'reddit', url: 'r/birding', displayLabel: 'r/birding',
    });
  });

  it('detects subreddit URLs and lowercases', () => {
    expect(detectSource('https://www.reddit.com/r/Birding/')).toEqual({
      type: 'reddit', url: 'r/birding', displayLabel: 'r/birding',
    });
  });

  it('detects YouTube channel URLs', () => {
    expect(detectSource('https://www.youtube.com/channel/UC1234567890123456789012')).toEqual({
      type: 'youtube',
      url: 'UC1234567890123456789012',
      displayLabel: 'YouTube: UC1234567890123456789012',
    });
  });

  it('rejects YouTube @handles with a helpful message', () => {
    const r = detectSource('https://youtube.com/@mkbhd');
    expect(r).toHaveProperty('error');
  });

  it('detects Substack URLs and normalizes to /feed', () => {
    expect(detectSource('https://stratechery.substack.com')).toEqual({
      type: 'substack',
      url: 'https://stratechery.substack.com/feed',
      displayLabel: 'stratechery.substack.com',
    });
  });

  it('falls through to rss for arbitrary http URLs', () => {
    expect(detectSource('https://example.com/feed.xml')).toEqual({
      type: 'rss', url: 'https://example.com/feed.xml', displayLabel: 'https://example.com/feed.xml',
    });
  });

  it('returns an error for empty input', () => {
    expect(detectSource('')).toEqual({ error: 'Empty source identifier' });
  });
});

describe('detectSource — Hacker News', () => {
  it('detects news.ycombinator.com host', () => {
    expect(detectSource('https://news.ycombinator.com')).toEqual({
      type: 'hn',
      url: 'https://news.ycombinator.com/rss',
      displayLabel: 'Hacker News',
    });
  });

  it('detects the bare hostname', () => {
    expect(detectSource('news.ycombinator.com')).toMatchObject({ type: 'hn' });
  });

  it('detects the rss URL directly', () => {
    expect(detectSource('https://news.ycombinator.com/rss')).toMatchObject({
      type: 'hn',
      url: 'https://news.ycombinator.com/rss',
    });
  });

  it('accepts the "hn" shorthand', () => {
    expect(detectSource('hn')).toMatchObject({ type: 'hn' });
  });

  it('does not falsely match subdomain extensions of news.ycombinator.com', () => {
    // Without anchoring, `\b` would let 'news.ycombinator.com.evil.com' match.
    // The fix uses (?:\/|$) so this falls through to the rss branch.
    const r = detectSource('https://news.ycombinator.com.evil.com');
    expect(r).toMatchObject({ type: 'rss' });
  });
});

describe('detectSource — Mastodon', () => {
  it('detects mastodon.social @user URL', () => {
    expect(detectSource('https://mastodon.social/@gargron')).toEqual({
      type: 'mastodon',
      url: 'https://mastodon.social/@gargron.rss',
      displayLabel: '@gargron@mastodon.social',
    });
  });

  it('detects /users/<user> form', () => {
    expect(detectSource('https://hachyderm.io/users/molly0xfff')).toMatchObject({
      type: 'mastodon',
      url: 'https://hachyderm.io/@molly0xfff.rss',
    });
  });

  it('detects fediverse @user@instance shorthand', () => {
    expect(detectSource('@gargron@mastodon.social')).toMatchObject({
      type: 'mastodon',
      url: 'https://mastodon.social/@gargron.rss',
    });
  });

  it('accepts the explicit .rss URL unchanged', () => {
    expect(detectSource('https://mastodon.social/@gargron.rss')).toMatchObject({
      type: 'mastodon',
      url: 'https://mastodon.social/@gargron.rss',
    });
  });

  it('rejects mastodon.social hashtag URLs (not supported yet)', () => {
    const r = detectSource('https://mastodon.social/tags/birding');
    expect(r).toHaveProperty('error');
  });
});

describe('expandFetchUrl — existing types', () => {
  it('expands subreddit shorthand to the .json listing URL', () => {
    expect(expandFetchUrl('reddit', 'r/birding')).toBe(
      'https://www.reddit.com/r/birding/.json?limit=25',
    );
  });

  it('expands a YouTube channel ID to the uploads xml feed', () => {
    expect(expandFetchUrl('youtube', 'UCabc')).toBe(
      'https://www.youtube.com/feeds/videos.xml?channel_id=UCabc',
    );
  });

  it('passes rss URLs through unchanged', () => {
    expect(expandFetchUrl('rss', 'https://example.com/feed.xml')).toBe(
      'https://example.com/feed.xml',
    );
  });
});
