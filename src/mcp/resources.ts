import { dbAll } from '../db/helpers';

// ---------------------------------------------------------------------------
// Resource definitions (MCP resources/list response)
// ---------------------------------------------------------------------------

export const RESOURCE_DEFINITIONS = [
  {
    uri: 'nebularnews://feeds',
    name: 'Feed Subscriptions',
    description: 'The user\'s subscribed feeds',
    mimeType: 'text/plain',
  },
  {
    uri: 'nebularnews://articles/recent',
    name: 'Recent Articles',
    description: 'Last 20 articles across the user\'s subscribed feeds',
    mimeType: 'text/plain',
  },
];

// ---------------------------------------------------------------------------
// Resource handlers
// ---------------------------------------------------------------------------

type ResourceContext = {
  db: D1Database;
  userId: string;
};

export async function handleResourceRead(
  uri: string,
  ctx: ResourceContext,
): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
  switch (uri) {
    case 'nebularnews://feeds':           return readFeeds(ctx);
    case 'nebularnews://articles/recent': return readRecentArticles(ctx);
    default:
      return { contents: [{ uri, mimeType: 'text/plain', text: `Unknown resource: ${uri}` }] };
  }
}

async function readFeeds(ctx: ResourceContext) {
  const feeds = await dbAll<{ title: string | null; url: string; site_url: string | null; paused: number }>(
    ctx.db,
    `SELECT f.title, f.url, f.site_url, COALESCE(ufs.paused, 0) AS paused
     FROM feeds f
     JOIN user_feed_subscriptions ufs ON ufs.feed_id = f.id AND ufs.user_id = ?
     ORDER BY COALESCE(f.title, f.url) ASC`,
    [ctx.userId],
  );

  const text = feeds
    .map(f => `${f.title ?? f.url}${f.paused ? ' (paused)' : ''} — ${f.site_url ?? f.url}`)
    .join('\n');
  return {
    contents: [{
      uri: 'nebularnews://feeds',
      mimeType: 'text/plain',
      text: text || 'No feeds subscribed.',
    }],
  };
}

async function readRecentArticles(ctx: ResourceContext) {
  const articles = await dbAll<{
    id: string; title: string; canonical_url: string; published_at: number | null;
    fetched_at: number | null; excerpt: string | null;
  }>(
    ctx.db,
    `SELECT DISTINCT a.id, a.title, a.canonical_url, a.published_at, a.fetched_at, a.excerpt
     FROM articles a
     JOIN article_sources asrc ON asrc.article_id = a.id
     JOIN user_feed_subscriptions ufs ON ufs.feed_id = asrc.feed_id AND ufs.user_id = ?
     WHERE COALESCE(ufs.paused, 0) = 0
     ORDER BY COALESCE(a.published_at, a.fetched_at) DESC
     LIMIT 20`,
    [ctx.userId],
  );

  const lines = articles.map(a => {
    const ts = a.published_at ?? a.fetched_at;
    const date = ts ? new Date(ts).toISOString().slice(0, 10) : '?';
    const excerpt = a.excerpt ? `\n  ${a.excerpt.slice(0, 200)}` : '';
    return `[${date}] ${a.title} (id: ${a.id})${excerpt}`;
  });

  return {
    contents: [{
      uri: 'nebularnews://articles/recent',
      mimeType: 'text/plain',
      text: lines.join('\n\n') || 'No recent articles.',
    }],
  };
}
