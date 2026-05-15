// Pure helpers for the Bluesky / ATProto poller. Designed to be testable
// without network or DB.

const AT_POST_RE = /^at:\/\/(did:[a-z0-9:_.-]+)\/app\.bsky\.feed\.post\/([a-z0-9]+)$/;

/**
 * Convert an ATProto post URI to its public bsky.app URL.
 * Returns null for non-post URIs (likes, follows, etc.) or malformed input.
 */
export function atUriToBskyUrl(atUri: string, authorHandle: string): string | null {
  const m = atUri.match(AT_POST_RE);
  if (!m) return null;
  const [, , rkey] = m;
  return `https://bsky.app/profile/${authorHandle}/post/${rkey}`;
}

export interface BlueskyPost {
  uri: string;
  canonicalUrl: string;
  text: string;
  authorHandle: string;
  authorDisplayName: string | null;
  publishedAt: number;
  imageUrl: string | null;
  isReply: boolean;
  raw: { replyCount?: number; repostCount?: number; likeCount?: number };
}

interface RawFeedView {
  post?: {
    uri?: string;
    author?: { handle?: string; displayName?: string };
    record?: {
      text?: string;
      createdAt?: string;
      reply?: unknown;
    };
    embed?: {
      $type?: string;
      images?: Array<{ thumb?: string }>;
    };
    replyCount?: number;
    repostCount?: number;
    likeCount?: number;
  };
  reason?: { $type?: string };
}

interface RawAuthorFeed {
  feed?: RawFeedView[] | null;
}

/**
 * Parse an app.bsky.feed.getAuthorFeed response into normalized post records.
 * Skips reposts (the `reason` field marks them; they're authored by someone
 * else and would clutter the user's library with content from accounts they
 * don't follow on the NebularNews side).
 */
export function parseAuthorFeed(raw: unknown): BlueskyPost[] {
  const feed = (raw as RawAuthorFeed)?.feed;
  if (!Array.isArray(feed)) return [];

  const out: BlueskyPost[] = [];
  for (const item of feed) {
    if (item.reason) continue;                 // skip reposts
    const post = item.post;
    if (!post || !post.uri || !post.author?.handle) continue;
    const text = post.record?.text ?? '';
    const createdAt = post.record?.createdAt;
    if (!createdAt) continue;

    const canonical = atUriToBskyUrl(post.uri, post.author.handle);
    if (!canonical) continue;

    out.push({
      uri: post.uri,
      canonicalUrl: canonical,
      text,
      authorHandle: post.author.handle,
      authorDisplayName: post.author.displayName ?? null,
      publishedAt: Date.parse(createdAt),
      imageUrl: post.embed?.images?.[0]?.thumb ?? null,
      isReply: Boolean(post.record?.reply),
      raw: {
        replyCount: post.replyCount,
        repostCount: post.repostCount,
        likeCount: post.likeCount,
      },
    });
  }
  return out;
}
