// Converts pasted source URLs into RSS/Atom equivalents.
// Mirrors NebularNews/NebularNews/Services/FeedURLNormalizer.swift on iOS.
//
// When scrapeMode is populated, callers should subscribe with that mode set so
// feeds that deliver only link stubs (Reddit, HN) get deep-fetched on poll.

export type FeedURLNormalized = {
  url: string;
  scrapeMode: string | null;
  sourceLabel: string | null;
};

export function normalizeFeedURL(raw: string): FeedURLNormalized {
  const trimmed = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { url: trimmed, scrapeMode: null, sourceLabel: null };
  }

  const host = parsed.host.toLowerCase();
  const path = parsed.pathname;

  // Reddit subreddit.
  if (host === 'reddit.com' || host === 'www.reddit.com' || host === 'old.reddit.com') {
    const match = path.match(/^\/r\/([^/]+)/);
    if (match) {
      return {
        url: `https://www.reddit.com/r/${match[1]}/.rss`,
        scrapeMode: 'auto_fetch_on_empty',
        sourceLabel: 'Subreddit – will fetch full posts',
      };
    }
  }

  // YouTube channel id (resolvable); @handle cannot be resolved without a network call.
  if (host === 'youtube.com' || host === 'www.youtube.com') {
    if (path.startsWith('/@')) {
      const handle = path.slice(2).split('/')[0] ?? '';
      return {
        url: `https://www.youtube.com/@${handle}`,
        scrapeMode: null,
        sourceLabel: 'YouTube – cannot auto-resolve @handle. Paste the channel RSS URL (youtube.com/feeds/videos.xml?channel_id=…).',
      };
    }
    if (path.startsWith('/channel/')) {
      const channelId = path.slice('/channel/'.length).split('/')[0] ?? '';
      if (channelId) {
        return {
          url: `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`,
          scrapeMode: null,
          sourceLabel: 'YouTube Channel',
        };
      }
    }
  }

  // Mastodon profile.
  if (/^\/@[^/]+$/.test(path)) {
    const base = `${parsed.protocol}//${parsed.host}${path}`;
    return {
      url: base.endsWith('.rss') ? base : `${base}.rss`,
      scrapeMode: null,
      sourceLabel: 'Mastodon Account',
    };
  }

  // Hacker News front page.
  if (host === 'news.ycombinator.com' && (path === '/' || path === '')) {
    return {
      url: 'https://hnrss.org/frontpage',
      scrapeMode: 'auto_fetch_on_empty',
      sourceLabel: 'Hacker News – will fetch full articles',
    };
  }

  return { url: trimmed, scrapeMode: null, sourceLabel: null };
}
