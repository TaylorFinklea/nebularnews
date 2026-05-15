import { describe, it, expect } from 'vitest';
import { atUriToBskyUrl } from '../bluesky';

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
});
