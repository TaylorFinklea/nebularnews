// src/lib/__tests__/source-detect.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { detectSource, expandFetchUrl } from '../source-detect';

describe('detectSource — existing patterns (regression)', () => {
  it('detects subreddit shorthand', async () => {
    expect(await detectSource('r/birding')).toEqual({
      type: 'reddit', url: 'r/birding', displayLabel: 'r/birding',
    });
  });

  it('detects subreddit URLs and lowercases', async () => {
    expect(await detectSource('https://www.reddit.com/r/Birding/')).toEqual({
      type: 'reddit', url: 'r/birding', displayLabel: 'r/birding',
    });
  });

  it('detects YouTube channel URLs', async () => {
    expect(await detectSource('https://www.youtube.com/channel/UC1234567890123456789012')).toEqual({
      type: 'youtube',
      url: 'UC1234567890123456789012',
      displayLabel: 'YouTube: UC1234567890123456789012',
    });
  });

  it('detects Substack URLs and normalizes to /feed', async () => {
    expect(await detectSource('https://stratechery.substack.com')).toEqual({
      type: 'substack',
      url: 'https://stratechery.substack.com/feed',
      displayLabel: 'stratechery.substack.com',
    });
  });

  it('falls through to rss for arbitrary http URLs', async () => {
    expect(await detectSource('https://example.com/feed.xml')).toEqual({
      type: 'rss', url: 'https://example.com/feed.xml', displayLabel: 'https://example.com/feed.xml',
    });
  });

  it('returns an error for empty input', async () => {
    expect(await detectSource('')).toEqual({ error: 'Empty source identifier' });
  });
});

describe('detectSource — Hacker News', () => {
  it('detects news.ycombinator.com host', async () => {
    expect(await detectSource('https://news.ycombinator.com')).toEqual({
      type: 'hn',
      url: 'https://news.ycombinator.com/rss',
      displayLabel: 'Hacker News',
    });
  });

  it('detects the bare hostname', async () => {
    expect(await detectSource('news.ycombinator.com')).toMatchObject({ type: 'hn' });
  });

  it('detects the rss URL directly', async () => {
    expect(await detectSource('https://news.ycombinator.com/rss')).toMatchObject({
      type: 'hn',
      url: 'https://news.ycombinator.com/rss',
    });
  });

  it('accepts the "hn" shorthand', async () => {
    expect(await detectSource('hn')).toMatchObject({ type: 'hn' });
  });

  it('does not falsely match subdomain extensions of news.ycombinator.com', async () => {
    // Without anchoring, `\b` would let 'news.ycombinator.com.evil.com' match.
    // The fix uses (?:\/|$) so this falls through to the rss branch.
    const r = await detectSource('https://news.ycombinator.com.evil.com');
    expect(r).toMatchObject({ type: 'rss' });
  });
});

describe('detectSource — Mastodon', () => {
  it('detects mastodon.social @user URL', async () => {
    expect(await detectSource('https://mastodon.social/@gargron')).toEqual({
      type: 'mastodon',
      url: 'https://mastodon.social/@gargron.rss',
      displayLabel: '@gargron@mastodon.social',
    });
  });

  it('detects /users/<user> form', async () => {
    expect(await detectSource('https://hachyderm.io/users/molly0xfff')).toMatchObject({
      type: 'mastodon',
      url: 'https://hachyderm.io/@molly0xfff.rss',
    });
  });

  it('detects fediverse @user@instance shorthand', async () => {
    expect(await detectSource('@gargron@mastodon.social')).toMatchObject({
      type: 'mastodon',
      url: 'https://mastodon.social/@gargron.rss',
    });
  });

  it('accepts the explicit .rss URL unchanged', async () => {
    expect(await detectSource('https://mastodon.social/@gargron.rss')).toMatchObject({
      type: 'mastodon',
      url: 'https://mastodon.social/@gargron.rss',
    });
  });

  it('rejects mastodon.social hashtag URLs (not supported yet)', async () => {
    const r = await detectSource('https://mastodon.social/tags/birding');
    expect(r).toHaveProperty('error');
  });

  it('lowercases mixed-case usernames in the URL', async () => {
    // Mastodon serves RSS only at the lowercased path on many instances;
    // storing the cased path produces silent 404s during polling.
    expect(await detectSource('https://mastodon.social/@Gargron')).toMatchObject({
      type: 'mastodon',
      url: 'https://mastodon.social/@gargron.rss',
      displayLabel: '@gargron@mastodon.social',
    });
  });
});

describe('detectSource — Bluesky', () => {
  it('detects a bsky.app profile URL', async () => {
    expect(await detectSource('https://bsky.app/profile/taylor.bsky.social')).toEqual({
      type: 'bluesky',
      url: 'https://bsky.app/profile/taylor.bsky.social',
      displayLabel: '@taylor.bsky.social',
    });
  });

  it('detects a custom-domain handle URL', async () => {
    expect(await detectSource('https://bsky.app/profile/jay.bsky.team')).toMatchObject({
      type: 'bluesky',
      displayLabel: '@jay.bsky.team',
    });
  });

  it('detects an @handle shorthand', async () => {
    expect(await detectSource('@taylor.bsky.social')).toMatchObject({
      type: 'bluesky',
      url: 'https://bsky.app/profile/taylor.bsky.social',
    });
  });

  it('does NOT collide with Mastodon @user@instance form', async () => {
    // Two-part fediverse form should stay Mastodon
    expect(await detectSource('@gargron@mastodon.social')).toMatchObject({ type: 'mastodon' });
  });

  it('rejects handles with hyphens at label boundaries', async () => {
    // Bluesky handles are domain names; RFC 1123 forbids leading/trailing
    // hyphens per label. Bad handles must NOT be claimed as Bluesky.
    expect(await detectSource('@-foo.bsky.social')).not.toMatchObject({ type: 'bluesky' });
    expect(await detectSource('@foo-.bsky.social')).not.toMatchObject({ type: 'bluesky' });
    expect(await detectSource('@foo.-bar.social')).not.toMatchObject({ type: 'bluesky' });
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

describe('detectSource — YouTube @handle resolution', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('resolves @handle to UC channel id via <link rel="canonical">', async () => {
    const html = `
      <html><head>
        <title>MKBHD - YouTube</title>
        <link rel="canonical" href="https://www.youtube.com/channel/UCBJycsmduvYEL83R_U4JriQ">
      </head><body>content</body></html>
    `;
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(html));
    const result = await detectSource('https://youtube.com/@MKBHD');
    expect(result).toEqual({
      type: 'youtube',
      url: 'UCBJycsmduvYEL83R_U4JriQ',
      displayLabel: 'YouTube: @MKBHD',
    });
  });

  it('falls back to <meta itemprop="channelId"> when canonical is missing', async () => {
    const html = `
      <html><head>
        <meta itemprop="channelId" content="UCBJycsmduvYEL83R_U4JriQ">
      </head><body></body></html>
    `;
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(html));
    const result = await detectSource('https://youtube.com/@MKBHD');
    expect(result).toMatchObject({
      type: 'youtube',
      url: 'UCBJycsmduvYEL83R_U4JriQ',
    });
  });

  it('returns an error when neither canonical nor itemprop is present', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('<html><head></head><body>nope</body></html>'));
    const result = await detectSource('https://youtube.com/@bogus');
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toMatch(/resolve channel id/i);
  });

  it('returns an error on 404 response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 404 }));
    const result = await detectSource('https://youtube.com/@nonexistent');
    expect(result).toHaveProperty('error');
  });

  it('returns an error on network failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('network'));
    const result = await detectSource('https://youtube.com/@MKBHD');
    expect(result).toHaveProperty('error');
  });

  it('handles canonical link with extra attributes before rel', async () => {
    const html = `
      <html><head>
        <link type="text/html" rel="canonical" href="https://www.youtube.com/channel/UCBJycsmduvYEL83R_U4JriQ">
      </head><body></body></html>
    `;
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(html));
    const result = await detectSource('https://youtube.com/@MKBHD');
    expect(result).toMatchObject({ type: 'youtube', url: 'UCBJycsmduvYEL83R_U4JriQ' });
  });

  it('handles itemprop meta with extra attributes before itemprop', async () => {
    const html = `
      <html><head>
        <meta name="og:url" itemprop="channelId" content="UCBJycsmduvYEL83R_U4JriQ">
      </head><body></body></html>
    `;
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(html));
    const result = await detectSource('https://youtube.com/@MKBHD');
    expect(result).toMatchObject({ type: 'youtube', url: 'UCBJycsmduvYEL83R_U4JriQ' });
  });
});
