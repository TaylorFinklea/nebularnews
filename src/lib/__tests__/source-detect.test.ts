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
    const r = detectSource('https://www.youtube.com/channel/UC1234567890123456789012');
    expect(r).toMatchObject({ type: 'youtube', url: 'UC1234567890123456789012' });
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
