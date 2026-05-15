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
const HN_RE = /^(?:https?:\/\/)?(?:www\.)?news\.ycombinator\.com\b/i;

export function detectSource(rawInput: string): DetectedSource | { error: string } {
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
