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
