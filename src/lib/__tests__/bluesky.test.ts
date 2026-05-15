import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { atUriToBskyUrl, parseAuthorFeed } from '../bluesky';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const sampleFeed = JSON.parse(readFileSync(join(fixturesDir, 'bluesky-author-feed.json'), 'utf8'));

describe('atUriToBskyUrl', () => {
  it('converts a post AT-URI to a bsky.app profile post URL', () => {
    const uri = 'at://did:plc:abc123/app.bsky.feed.post/3klabcxyz';
    expect(atUriToBskyUrl(uri, 'taylor.bsky.social')).toBe(
      'https://bsky.app/profile/taylor.bsky.social/post/3klabcxyz',
    );
  });

  it('returns null for non-post AT-URIs', () => {
    expect(atUriToBskyUrl('at://did:plc:abc/app.bsky.feed.like/3k', 'h')).toBeNull();
  });

  it('returns null for malformed input', () => {
    expect(atUriToBskyUrl('not-an-at-uri', 'h')).toBeNull();
    expect(atUriToBskyUrl('', 'h')).toBeNull();
  });

  it('accepts a did:web: DID variant', () => {
    const uri = 'at://did:web:example.com/app.bsky.feed.post/3klabcxyz';
    expect(atUriToBskyUrl(uri, 'example.bsky.social')).toBe(
      'https://bsky.app/profile/example.bsky.social/post/3klabcxyz',
    );
  });

  it('rejects rkeys with uppercase letters (case-sensitive per ATProto spec)', () => {
    // ATProto rkeys are lowercase base32-sortable. Mixed-case rkeys would
    // produce broken bsky.app URLs, so detection must reject them.
    const uri = 'at://did:plc:abc/app.bsky.feed.post/3KABCXYZ';
    expect(atUriToBskyUrl(uri, 'taylor.bsky.social')).toBeNull();
  });
});

describe('parseAuthorFeed', () => {
  it('returns one record per non-repost post', () => {
    const out = parseAuthorFeed(sampleFeed);
    expect(out).toHaveLength(3); // skip the repost
  });

  it('skips reposts (authored by someone else)', () => {
    const out = parseAuthorFeed(sampleFeed);
    expect(out.find((p) => p.uri.includes('3klrepost'))).toBeUndefined();
  });

  it('extracts canonical URL, text, author handle, createdAt', () => {
    const out = parseAuthorFeed(sampleFeed);
    const first = out.find((p) => p.uri.includes('3klpost1'))!;
    expect(first.canonicalUrl).toBe('https://bsky.app/profile/alice.bsky.social/post/3klpost1');
    expect(first.text).toBe('Hello Bluesky from the test fixture.');
    expect(first.authorHandle).toBe('alice.bsky.social');
    expect(first.publishedAt).toBe(Date.parse('2026-05-01T12:00:00.000Z'));
  });

  it('captures image embed thumbnail URL when present', () => {
    const out = parseAuthorFeed(sampleFeed);
    const withImg = out.find((p) => p.uri.includes('3klimage'))!;
    expect(withImg.imageUrl).toMatch(/^https:\/\/cdn\.bsky\.app\/img\/feed_thumbnail\//);
  });

  it('flags replies', () => {
    const out = parseAuthorFeed(sampleFeed);
    const reply = out.find((p) => p.uri.includes('3klreply'))!;
    expect(reply.isReply).toBe(true);
  });

  it('returns empty array for missing or malformed feed', () => {
    expect(parseAuthorFeed({})).toEqual([]);
    expect(parseAuthorFeed({ feed: null })).toEqual([]);
  });
});
