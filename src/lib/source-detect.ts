// Source-type detection from a URL or shorthand string. Used by add_feed
// (HTTP route + MCP tool) so callers can paste any supported source — full
// URL, subreddit shorthand, YouTube channel ID — and the right poller
// picks it up later.

export type SourceType = 'rss' | 'reddit' | 'youtube' | 'substack' | 'hn' | 'mastodon' | 'bluesky';

export interface DetectedSource {
  /** Canonical type for storage in feeds.source_type. */
  type: SourceType;
  /** Canonical identifier stored in feeds.url. Per-type: */
  /// - rss/substack: the feed URL */
  /// - reddit: subreddit shorthand like 'r/birding' */
  /// - youtube: channel ID like 'UCxxxx' */
  url: string;
  /** Human-friendly label suitable for display until the poller writes a real title. */
  displayLabel: string;
}

const REDDIT_RE = /^(?:https?:\/\/(?:www\.|old\.|new\.)?reddit\.com)?\/?r\/([a-zA-Z0-9][a-zA-Z0-9_]{1,30})\/?$/i;
const YT_CHANNEL_URL_RE = /^https?:\/\/(?:www\.)?youtube\.com\/channel\/(UC[a-zA-Z0-9_-]{22})/i;
const YT_CHANNEL_ID_RE = /^UC[a-zA-Z0-9_-]{22}$/;
const YT_HANDLE_RE = /^https?:\/\/(?:www\.)?youtube\.com\/@([a-zA-Z0-9_.-]+)/i;
const SUBSTACK_RE = /^https?:\/\/([a-z0-9-]+)\.substack\.com\b/i;
const HN_RE = /^(?:https?:\/\/)?(?:www\.)?news\.ycombinator\.com(?:\/|$)/i;
const MASTODON_AT_RE = /^@([a-zA-Z0-9_]+)@([a-z0-9.-]+\.[a-z]{2,})$/i;
const MASTODON_USER_URL_RE = /^https?:\/\/([a-z0-9.-]+\.[a-z]{2,})\/@([a-zA-Z0-9_]+)(?:\.rss)?\/?$/i;
const MASTODON_USERS_URL_RE = /^https?:\/\/([a-z0-9.-]+\.[a-z]{2,})\/users\/([a-zA-Z0-9_]+)\/?$/i;
const MASTODON_TAGS_URL_RE = /^https?:\/\/([a-z0-9.-]+\.[a-z]{2,})\/tags\/[a-zA-Z0-9_]+\/?$/i;
const BSKY_URL_RE = /^https?:\/\/bsky\.app\/profile\/([a-z0-9.-]+)\/?$/i;
// Bluesky @handle shorthand. Handle = valid domain name (label.label[.label]…).
// Each label: starts/ends with [a-z0-9], hyphens only allowed in the middle.
const BSKY_HANDLE_RE = /^@([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)$/i;

function buildMastodonDetection(instance: string, user: string): DetectedSource {
  return {
    type: 'mastodon',
    url: `https://${instance}/@${user}.rss`,
    displayLabel: `@${user}@${instance}`,
  };
}

export async function detectSource(rawInput: string): Promise<DetectedSource | { error: string }> {
  const input = rawInput.trim();
  if (!input) return { error: 'Empty source identifier' };

  // Reddit shorthand or URL — store as r/<lowercased>
  const redditMatch = input.match(REDDIT_RE);
  if (redditMatch) {
    const sub = redditMatch[1].toLowerCase();
    return { type: 'reddit', url: `r/${sub}`, displayLabel: `r/${sub}` };
  }

  // YouTube — accept raw channel ID or full /channel/UCxxxx URL.
  const ytUrlMatch = input.match(YT_CHANNEL_URL_RE);
  if (ytUrlMatch) {
    const id = ytUrlMatch[1];
    return { type: 'youtube', url: id, displayLabel: `YouTube: ${id}` };
  }
  if (YT_CHANNEL_ID_RE.test(input)) {
    return { type: 'youtube', url: input, displayLabel: `YouTube: ${input}` };
  }
  if (YT_HANDLE_RE.test(input)) {
    return {
      error: 'YouTube @handles aren\'t supported yet — paste the channel ID (UC…) or the /channel/UC… URL. You can find it on the channel page → Share → Copy channel ID.',
    };
  }

  // Bluesky — bsky.app profile URLs or single-@ handle shorthands.
  // The URL form (/profile/) has no overlap with Mastodon URL patterns (/@user),
  // so ordering vs. Mastodon doesn't matter for URLs. For the @handle form,
  // the !MASTODON_AT_RE guard below is what prevents @user@instance from being
  // claimed here — not the ordering.
  const bskyUrl = input.match(BSKY_URL_RE);
  if (bskyUrl) {
    const handle = bskyUrl[1].toLowerCase();
    return {
      type: 'bluesky',
      url: `https://bsky.app/profile/${handle}`,
      displayLabel: `@${handle}`,
    };
  }

  const bskyAt = input.match(BSKY_HANDLE_RE);
  if (bskyAt && !MASTODON_AT_RE.test(input)) {
    const handle = bskyAt[1].toLowerCase();
    return {
      type: 'bluesky',
      url: `https://bsky.app/profile/${handle}`,
      displayLabel: `@${handle}`,
    };
  }

  // Mastodon — federated, so we can't validate the host. We accept any
  // /@user URL or /users/<user> URL as Mastodon. This means non-Mastodon
  // hosts that use the same path shape (e.g. Ghost author pages, GitHub
  // /users/foo) will be misclassified as Mastodon and produce a broken
  // feed. The single-user-operator workflow can recover by removing the
  // feed; we don't denylist hosts because the list would need ongoing
  // maintenance.
  const mAt = input.match(MASTODON_AT_RE);
  if (mAt) return buildMastodonDetection(mAt[2].toLowerCase(), mAt[1].toLowerCase());

  const mUserUrl = input.match(MASTODON_USER_URL_RE);
  if (mUserUrl) return buildMastodonDetection(mUserUrl[1].toLowerCase(), mUserUrl[2].toLowerCase());

  const mUsersUrl = input.match(MASTODON_USERS_URL_RE);
  if (mUsersUrl) return buildMastodonDetection(mUsersUrl[1].toLowerCase(), mUsersUrl[2].toLowerCase());

  if (MASTODON_TAGS_URL_RE.test(input)) {
    return {
      error: 'Mastodon hashtag feeds aren\'t supported yet — paste a user URL like https://mastodon.social/@user instead.',
    };
  }

  // Hacker News — normalize to the stable RSS endpoint.
  if (input.toLowerCase() === 'hn' || HN_RE.test(input)) {
    return {
      type: 'hn',
      url: 'https://news.ycombinator.com/rss',
      displayLabel: 'Hacker News',
    };
  }

  // Substack — auto-route to the publication's /feed RSS endpoint.
  const substackMatch = input.match(SUBSTACK_RE);
  if (substackMatch) {
    const stripped = input.replace(/\/+$/, '');
    const finalUrl = /\/feed(?:\?|$|\/)/.test(stripped)
      ? stripped
      : `https://${substackMatch[1]}.substack.com/feed`;
    return { type: 'substack', url: finalUrl, displayLabel: `${substackMatch[1]}.substack.com` };
  }

  // Anything else with http(s) — assume RSS.
  if (/^https?:\/\//i.test(input)) {
    return { type: 'rss', url: input, displayLabel: input };
  }

  return { error: 'Unrecognized source. Paste an RSS feed URL, a Substack publication URL, a subreddit (r/name), or a YouTube channel ID (UC…).' };
}

// Expand a stored canonical identifier to a fetch-ready URL for the poller.
export function expandFetchUrl(type: SourceType, storedUrl: string): string {
  switch (type) {
    case 'reddit': {
      // Stored as 'r/birding' — Reddit's JSON listing endpoint.
      const sub = storedUrl.startsWith('r/') ? storedUrl.slice(2) : storedUrl;
      return `https://www.reddit.com/r/${sub}/.json?limit=25`;
    }
    case 'youtube':
      return `https://www.youtube.com/feeds/videos.xml?channel_id=${storedUrl}`;
    case 'rss':
    case 'substack':
    default:
      return storedUrl;
  }
}
