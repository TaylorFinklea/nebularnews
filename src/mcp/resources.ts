import { dbAll, dbGet } from '../db/helpers';

// ---------------------------------------------------------------------------
// Resource definitions (MCP resources/list response)
// ---------------------------------------------------------------------------

export const RESOURCE_DEFINITIONS = [
  {
    uri: 'nebularnews://feeds',
    name: 'Feed Subscriptions',
    description: 'Your RSS feed subscriptions',
    mimeType: 'text/plain',
  },
  {
    uri: 'nebularnews://articles/recent',
    name: 'Recent Articles',
    description: 'Last 20 articles with titles, scores, and summaries',
    mimeType: 'text/plain',
  },
  {
    uri: 'nebularnews://brief/latest',
    name: 'Latest Brief',
    description: 'Most recent news brief',
    mimeType: 'text/plain',
  },
  {
    uri: 'nebularnews://reading-history',
    name: 'Reading History',
    description: 'Recent reading activity',
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
    case 'nebularnews://feeds': return readFeeds(ctx);
    case 'nebularnews://articles/recent': return readRecentArticles(ctx);
    case 'nebularnews://brief/latest': return readLatestBrief(ctx);
    case 'nebularnews://reading-history': return readReadingHistory(ctx);
    default:
      return { contents: [{ uri, mimeType: 'text/plain', text: `Unknown resource: ${uri}` }] };
  }
}

async function readFeeds(ctx: ResourceContext) {
  const feeds = await dbAll<{ title: string; feed_url: string; site_url: string | null; paused: number }>(
    ctx.db,
    `SELECT f.title, f.feed_url, f.site_url, COALESCE(ufs.paused, 0) AS paused
     FROM feeds f
     JOIN user_feed_subscriptions ufs ON ufs.feed_id = f.id AND ufs.user_id = ?
     ORDER BY f.title ASC`,
    [ctx.userId],
  );

  const text = feeds.map(f => `${f.title}${f.paused ? ' (paused)' : ''} — ${f.site_url ?? f.feed_url}`).join('\n');
  return { contents: [{ uri: 'nebularnews://feeds', mimeType: 'text/plain', text: text || 'No feeds subscribed.' }] };
}

async function readRecentArticles(ctx: ResourceContext) {
  const articles = await dbAll<{
    id: string; title: string; canonical_url: string; published_at: number | null;
  }>(
    ctx.db,
    `SELECT a.id, a.title, a.canonical_url, a.published_at
     FROM articles a
     JOIN user_feed_subscriptions ufs ON ufs.feed_id = a.feed_id AND ufs.user_id = ?
     ORDER BY COALESCE(a.published_at, a.fetched_at) DESC
     LIMIT 20`,
    [ctx.userId],
  );

  const lines: string[] = [];
  for (const a of articles) {
    const score = await dbGet<{ score: number }>(
      ctx.db,
      `SELECT score FROM article_scores WHERE article_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1`,
      [a.id, ctx.userId],
    );
    const summary = await dbGet<{ summary_text: string }>(
      ctx.db,
      `SELECT summary_text FROM article_summaries WHERE article_id = ? ORDER BY created_at DESC LIMIT 1`,
      [a.id],
    );
    const date = a.published_at ? new Date(a.published_at).toISOString().slice(0, 10) : '?';
    lines.push(
      `[${date}] ${a.title} (score: ${score?.score ?? '?'}/5, id: ${a.id})${summary?.summary_text ? `\n  ${summary.summary_text}` : ''}`,
    );
  }

  return { contents: [{ uri: 'nebularnews://articles/recent', mimeType: 'text/plain', text: lines.join('\n\n') || 'No recent articles.' }] };
}

async function readLatestBrief(ctx: ResourceContext) {
  const brief = await dbGet<{ brief_text: string; edition_type: string; created_at: number }>(
    ctx.db,
    `SELECT brief_text, edition_type, created_at FROM news_brief_editions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`,
    [ctx.userId],
  );

  if (!brief) {
    return { contents: [{ uri: 'nebularnews://brief/latest', mimeType: 'text/plain', text: 'No brief available.' }] };
  }

  let text = `${brief.edition_type ?? 'Latest'} brief (${new Date(brief.created_at).toISOString().slice(0, 16)}):\n\n`;
  try {
    const bullets = JSON.parse(brief.brief_text);
    if (Array.isArray(bullets)) {
      text += bullets.map((b: { text?: string }) => `- ${b.text ?? b}`).join('\n');
    } else {
      text += brief.brief_text;
    }
  } catch {
    text += brief.brief_text;
  }

  return { contents: [{ uri: 'nebularnews://brief/latest', mimeType: 'text/plain', text }] };
}

async function readReadingHistory(ctx: ResourceContext) {
  const history = await dbAll<{
    title: string; read_at: number;
  }>(
    ctx.db,
    `SELECT a.title, uas.read_at
     FROM user_article_states uas
     JOIN articles a ON a.id = uas.article_id
     WHERE uas.user_id = ? AND uas.read_at IS NOT NULL
     ORDER BY uas.read_at DESC
     LIMIT 20`,
    [ctx.userId],
  );

  const text = history.map(h =>
    `${new Date(h.read_at).toISOString().slice(0, 16)} — ${h.title}`,
  ).join('\n');

  return { contents: [{ uri: 'nebularnews://reading-history', mimeType: 'text/plain', text: text || 'No reading history.' }] };
}
