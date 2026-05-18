import { nanoid } from 'nanoid';
import { dbGet, dbAll, dbRun } from '../db/helpers';
import { detectSource } from '../lib/source-detect';

// ---------------------------------------------------------------------------
// MCP tool surface — focused retrieval for an LLM client.
//
// Six tools, no AI. The LLM (Claude/ChatGPT) does summarization, ranking,
// brief composition, and analysis. Our job is just to give it clean,
// queryable access to the user's subscribed content.
// ---------------------------------------------------------------------------

export const TOOL_DEFINITIONS = [
  {
    name: 'list_feeds',
    description: 'List the feeds (sources) the user is subscribed to. Returns each feed\'s id, title, url, and recent article count.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        include_paused: { type: 'boolean', description: 'Include paused feeds (default false)' },
      },
    },
  },
  {
    name: 'add_feed',
    description: 'Subscribe the user to a new content source. Accepts: an RSS/Atom feed URL, a Substack publication URL (e.g. https://example.substack.com), a subreddit (e.g. r/birding or https://reddit.com/r/birding), a YouTube channel ID (UC…) or /channel/UC… URL, a Hacker News URL or "hn" shorthand, a Mastodon user URL (e.g. https://mastodon.social/@user) or fediverse handle (@user@instance), a Bluesky profile URL (e.g. https://bsky.app/profile/handle.bsky.social) or @handle.bsky.social shorthand, or \'email\' / \'newsletter\' (returns a unique inbound address to subscribe your newsletter to). Returns the feed id and detected source_type. Use after the user confirms.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        source: { type: 'string', description: 'RSS URL, Substack URL, subreddit (r/name), or YouTube channel id/URL' },
      },
      required: ['source'],
    },
  },
  {
    name: 'remove_feed',
    description: 'Unsubscribe the user from a feed. Idempotent — succeeds even if the user wasn\'t subscribed.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        feed_id: { type: 'string', description: 'Feed id (from list_feeds)' },
      },
      required: ['feed_id'],
    },
  },
  {
    name: 'get_recent',
    description: 'Get recent articles across the user\'s subscribed feeds, newest first. Use this to compose a daily brief.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        since: { type: 'number', description: 'Unix epoch ms; only articles published or fetched after this time' },
        limit: { type: 'number', description: 'Max results (default 25, max 100)' },
        feed_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Restrict to specific feed ids (default: all subscribed feeds)',
        },
      },
    },
  },
  {
    name: 'search_articles',
    description: 'Full-text search across the user\'s articles. Returns titles, urls, and excerpts.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Max results (default 10, max 25)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_article',
    description: 'Fetch the full content of a single article by id. Returns title, url, author, published date, and full body text.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        article_id: { type: 'string', description: 'Article id (from search_articles or get_recent)' },
      },
      required: ['article_id'],
    },
  },
];

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

type ToolContext = {
  db: D1Database;
  userId: string;
};

type ToolResult = { content: Array<{ type: 'text'; text: string }> };

export async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  switch (name) {
    case 'list_feeds':      return listFeeds(args, ctx);
    case 'add_feed':        return addFeed(args, ctx);
    case 'remove_feed':     return removeFeed(args, ctx);
    case 'get_recent':      return getRecent(args, ctx);
    case 'search_articles': return searchArticles(args, ctx);
    case 'get_article':     return getArticle(args, ctx);
    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
  }
}

// ---------------------------------------------------------------------------
// list_feeds
// ---------------------------------------------------------------------------

async function listFeeds(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const includePaused = args.include_paused === true;

  const feeds = await dbAll<{
    id: string; title: string | null; site_url: string | null; url: string;
    paused: number; source_type: string;
  }>(
    ctx.db,
    `SELECT f.id, f.title, f.site_url, f.url, f.source_type, COALESCE(ufs.paused, 0) AS paused
     FROM feeds f
     JOIN user_feed_subscriptions ufs ON ufs.feed_id = f.id AND ufs.user_id = ?
     ${includePaused ? '' : 'WHERE COALESCE(ufs.paused, 0) = 0'}
     ORDER BY COALESCE(f.title, f.url) ASC`,
    [ctx.userId],
  );

  if (feeds.length === 0) {
    return { content: [{ type: 'text', text: 'No feed subscriptions found.' }] };
  }

  const lines = feeds.map(f => {
    const title = f.title ?? f.url;
    const link = f.site_url ?? f.url;
    return `- [${f.source_type}] **${title}**${f.paused ? ' (paused)' : ''}\n  id: \`${f.id}\`\n  ${link}`;
  });
  return { content: [{ type: 'text', text: `# Subscribed feeds (${feeds.length})\n\n${lines.join('\n')}` }] };
}

// ---------------------------------------------------------------------------
// add_feed
// ---------------------------------------------------------------------------

const DEFAULT_SCRAPE_MODE = 'auto_fetch_on_empty';

async function addFeed(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  // Accept either {source: ...} (preferred) or {url: ...} for back-compat
  // with anything pinned to the older tool schema.
  const raw = String(args.source ?? args.url ?? '').trim();
  if (!raw) {
    return { content: [{ type: 'text', text: 'Missing source. Pass an RSS URL, Substack URL, subreddit (r/name), or YouTube channel id (UC…).' }] };
  }

  const detected = await detectSource(raw);
  if ('error' in detected) {
    return { content: [{ type: 'text', text: detected.error }] };
  }

  if (detected.type === 'email_newsletter' && detected.url === '') {
    const feedId = nanoid();
    // MCP tools don't currently receive env; use the default. If the operator
    // overrides EMAIL_INBOUND_DOMAIN, the HTTP route uses it and the MCP tool
    // doesn't — both surfaces produce the same domain for personal-scale use.
    const inboundAddress = `nl-${nanoid(16)}@in.nebularnews.com`.toLowerCase();
    const now = Date.now();

    await dbRun(
      ctx.db,
      `INSERT INTO feeds (id, url, source_type, feed_type, inbound_address, scrape_mode)
       VALUES (?, ?, 'email_newsletter', 'email_newsletter', ?, 'rss_only')`,
      [feedId, inboundAddress, inboundAddress],
    );
    await dbRun(
      ctx.db,
      `INSERT INTO user_feed_subscriptions (id, user_id, feed_id, created_at)
       VALUES (?, ?, ?, ?)`,
      [nanoid(), ctx.userId, feedId, now],
    );

    return {
      content: [{
        type: 'text',
        text: `Created email-newsletter feed. Subscribe your newsletter to: ${inboundAddress}\n\nThe first email's From: address will be locked as the expected sender (trust-on-first-use). Later emails from a different sender will be quarantined.`,
      }],
    };
  }

  let feed = await dbGet<{ id: string; title: string | null; url: string; source_type: string }>(
    ctx.db,
    `SELECT id, title, url, source_type FROM feeds WHERE source_type = ? AND url = ?`,
    [detected.type, detected.url],
  );
  if (!feed) {
    const feedId = nanoid();
    await dbRun(
      ctx.db,
      `INSERT INTO feeds (id, url, source_type, scrape_mode) VALUES (?, ?, ?, ?)`,
      [feedId, detected.url, detected.type, DEFAULT_SCRAPE_MODE],
    );
    feed = { id: feedId, title: null, url: detected.url, source_type: detected.type };
  }

  await dbRun(
    ctx.db,
    `INSERT INTO user_feed_subscriptions (id, user_id, feed_id, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (user_id, feed_id) DO NOTHING`,
    [nanoid(), ctx.userId, feed.id, Date.now()],
  );

  const display = feed.title ?? detected.displayLabel;
  return {
    content: [{
      type: 'text',
      text: `Subscribed to **${display}** (${detected.type}).\nfeed_id: \`${feed.id}\`\n\nNew items will appear in get_recent within ~5 minutes.`,
    }],
  };
}

// ---------------------------------------------------------------------------
// remove_feed
// ---------------------------------------------------------------------------

async function removeFeed(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const feedId = String(args.feed_id ?? '').trim();
  if (!feedId) {
    return { content: [{ type: 'text', text: 'Missing feed_id.' }] };
  }

  const feed = await dbGet<{ title: string | null; url: string }>(
    ctx.db, `SELECT title, url FROM feeds WHERE id = ?`, [feedId],
  );

  await dbRun(
    ctx.db,
    `DELETE FROM user_feed_subscriptions WHERE user_id = ? AND feed_id = ?`,
    [ctx.userId, feedId],
  );

  const display = feed?.title ?? feed?.url ?? feedId;
  return { content: [{ type: 'text', text: `Unsubscribed from **${display}**.` }] };
}

// ---------------------------------------------------------------------------
// get_recent
// ---------------------------------------------------------------------------

async function getRecent(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const limit = Math.min(Number(args.limit) || 25, 100);
  const since = typeof args.since === 'number' ? Number(args.since) : 0;
  const feedIds = Array.isArray(args.feed_ids)
    ? (args.feed_ids as unknown[]).map(String).filter(Boolean)
    : null;

  const params: unknown[] = [ctx.userId];
  let feedFilter = '';
  if (feedIds && feedIds.length > 0) {
    feedFilter = `AND asrc.feed_id IN (${feedIds.map(() => '?').join(',')})`;
    params.push(...feedIds);
  }
  let sinceFilter = '';
  if (since > 0) {
    sinceFilter = `AND COALESCE(a.published_at, a.fetched_at) >= ?`;
    params.push(since);
  }
  params.push(limit);

  const rows = await dbAll<{
    id: string; title: string; canonical_url: string; excerpt: string | null;
    author: string | null; published_at: number | null; fetched_at: number | null;
    source_type: string;
    feed_id: string; feed_title: string | null;
  }>(
    ctx.db,
    `SELECT DISTINCT a.id, a.title, a.canonical_url, a.excerpt, a.author,
            a.published_at, a.fetched_at, a.source_type,
            asrc.feed_id, f.title AS feed_title
     FROM articles a
     JOIN article_sources asrc ON asrc.article_id = a.id
     JOIN user_feed_subscriptions ufs ON ufs.feed_id = asrc.feed_id AND ufs.user_id = ?
     LEFT JOIN feeds f ON f.id = asrc.feed_id
     WHERE COALESCE(ufs.paused, 0) = 0
       ${feedFilter}
       ${sinceFilter}
     ORDER BY COALESCE(a.published_at, a.fetched_at) DESC
     LIMIT ?`,
    params,
  );

  if (rows.length === 0) {
    return { content: [{ type: 'text', text: 'No recent articles in your subscribed feeds.' }] };
  }

  const lines = rows.map(r => {
    const ts = r.published_at ?? r.fetched_at;
    const date = ts ? new Date(ts).toISOString().slice(0, 10) : '?';
    const source = r.feed_title ? ` — *${r.feed_title}*` : '';
    const excerpt = r.excerpt ? `\n  ${r.excerpt.slice(0, 240)}${r.excerpt.length > 240 ? '…' : ''}` : '';
    return `- [${date} · ${r.source_type}] **${r.title}**${source}\n  id: \`${r.id}\`\n  ${r.canonical_url}${excerpt}`;
  });

  return { content: [{ type: 'text', text: `# Recent articles (${rows.length})\n\n${lines.join('\n\n')}` }] };
}

// ---------------------------------------------------------------------------
// search_articles
// ---------------------------------------------------------------------------

async function searchArticles(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const rawQuery = String(args.query ?? '');
  const limit = Math.min(Number(args.limit) || 10, 25);

  // FTS5 chokes on apostrophes/hyphens; tokenize to whitespace-separated word
  // characters. Falls back to the empty-result branch when sanitization
  // strips everything.
  const sanitized = (rawQuery.toLowerCase().match(/\w+/g) ?? []).join(' ');
  if (!sanitized) {
    return { content: [{ type: 'text', text: `No articles found for "${rawQuery}".` }] };
  }

  // Both article_search (FTS5) and articles have a `title` column — every
  // selected column is qualified to avoid "ambiguous column name".
  const rows = await dbAll<{
    article_id: string; title: string; canonical_url: string;
    excerpt: string | null; published_at: number | null;
  }>(
    ctx.db,
    `SELECT a.id AS article_id, a.title AS title, a.canonical_url AS canonical_url,
            a.excerpt AS excerpt, a.published_at AS published_at
     FROM article_search
     JOIN articles a ON a.id = article_search.article_id
     JOIN article_sources asrc ON asrc.article_id = a.id
     JOIN user_feed_subscriptions ufs ON ufs.feed_id = asrc.feed_id AND ufs.user_id = ?
     WHERE article_search MATCH ?
     GROUP BY a.id
     ORDER BY rank
     LIMIT ?`,
    [ctx.userId, sanitized, limit],
  );

  if (rows.length === 0) {
    return { content: [{ type: 'text', text: `No articles found for "${rawQuery}".` }] };
  }

  const lines = rows.map(r => {
    const date = r.published_at ? new Date(r.published_at).toISOString().slice(0, 10) : '?';
    const excerpt = r.excerpt ? `\n  ${r.excerpt.slice(0, 240)}${r.excerpt.length > 240 ? '…' : ''}` : '';
    return `- [${date}] **${r.title}**\n  id: \`${r.article_id}\`\n  ${r.canonical_url}${excerpt}`;
  });

  return { content: [{ type: 'text', text: `# Search results for "${rawQuery}" (${rows.length})\n\n${lines.join('\n\n')}` }] };
}

// ---------------------------------------------------------------------------
// get_article
// ---------------------------------------------------------------------------

async function getArticle(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const articleId = String(args.article_id ?? '');
  if (!articleId) {
    return { content: [{ type: 'text', text: 'Missing article_id.' }] };
  }

  const article = await dbGet<{
    id: string; title: string; canonical_url: string;
    content_text: string | null; published_at: number | null;
    author: string | null;
  }>(
    ctx.db,
    `SELECT id, title, canonical_url, content_text, published_at, author
     FROM articles WHERE id = ?`,
    [articleId],
  );

  if (!article) {
    return { content: [{ type: 'text', text: `Article not found: ${articleId}` }] };
  }

  let text = `# ${article.title}\n\n`;
  text += `**URL:** ${article.canonical_url}\n`;
  if (article.author) text += `**Author:** ${article.author}\n`;
  if (article.published_at) text += `**Published:** ${new Date(article.published_at).toISOString().slice(0, 10)}\n`;

  if (article.content_text) {
    const truncated = article.content_text.length > 12_000
      ? article.content_text.slice(0, 12_000) + '\n\n[Content truncated]'
      : article.content_text;
    text += `\n${truncated}`;
  } else {
    text += `\n*[No body content available — try fetching the URL directly.]*`;
  }

  return { content: [{ type: 'text', text }] };
}
