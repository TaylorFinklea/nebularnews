// Pure helpers for the Bluesky / ATProto poller. Designed to be testable
// without network or DB.

const AT_POST_RE = /^at:\/\/(did:[a-z0-9:_.-]+)\/app\.bsky\.feed\.post\/([a-z0-9]+)$/i;

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
