import { dbGet, dbAll } from '../db/helpers';
import { resolveAIKey } from '../lib/ai-key-resolver';
import { runChat, type ChatMessage } from '../lib/ai';

// ---------------------------------------------------------------------------
// Tool definitions (MCP tools/list response)
// ---------------------------------------------------------------------------

export const TOOL_DEFINITIONS = [
  {
    name: 'search_articles',
    description: 'Full-text search across your articles. Returns titles, scores, and summaries.',
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
    description: 'Get full article content including any AI-generated summary and key points.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        article_id: { type: 'string', description: 'Article ID' },
      },
      required: ['article_id'],
    },
  },
  {
    name: 'get_brief',
    description: 'Get the latest news brief — a summary of top recent articles.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        generate: { type: 'boolean', description: 'Generate a fresh brief if none exists (default false)' },
      },
    },
  },
  {
    name: 'list_feeds',
    description: 'List your RSS feed subscriptions with article counts.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        include_paused: { type: 'boolean', description: 'Include paused feeds (default false)' },
      },
    },
  },
  {
    name: 'ask_about_news',
    description: 'Ask a question about your recent articles. Uses AI to analyze across multiple articles.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        question: { type: 'string', description: 'Your question about recent news' },
      },
      required: ['question'],
    },
  },
  {
    name: 'get_article_summary',
    description: 'Get the AI-generated summary for a specific article.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        article_id: { type: 'string', description: 'Article ID' },
      },
      required: ['article_id'],
    },
  },
  {
    name: 'save_article',
    description: 'Save/bookmark an article for later reading.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        article_id: { type: 'string', description: 'Article ID' },
      },
      required: ['article_id'],
    },
  },
  {
    name: 'get_trending_topics',
    description: 'Get topics that are trending in your feeds based on recent article volume.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        window_hours: { type: 'number', description: 'Lookback window in hours (default 24)' },
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

type ToolContext = {
  db: D1Database;
  userId: string;
  req: Request;
  env: { OPENAI_API_KEY?: string; ANTHROPIC_API_KEY?: string };
};

type ToolResult = { content: Array<{ type: 'text'; text: string }> };

export async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  switch (name) {
    case 'search_articles': return searchArticles(args, ctx);
    case 'get_article': return getArticle(args, ctx);
    case 'get_brief': return getBrief(args, ctx);
    case 'list_feeds': return listFeeds(args, ctx);
    case 'ask_about_news': return askAboutNews(args, ctx);
    case 'get_article_summary': return getArticleSummary(args, ctx);
    case 'save_article': return saveArticle(args, ctx);
    case 'get_trending_topics': return getTrendingTopics(args, ctx);
    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
  }
}

// ---------------------------------------------------------------------------
// Individual tool implementations
// ---------------------------------------------------------------------------

async function searchArticles(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const query = String(args.query ?? '');
  const limit = Math.min(Number(args.limit) || 10, 25);

  const rows = await dbAll<{
    article_id: string; title: string; canonical_url: string;
    published_at: number | null;
  }>(
    ctx.db,
    `SELECT article_id, title, canonical_url, published_at
     FROM article_search
     JOIN articles a ON a.id = article_search.article_id
     WHERE article_search MATCH ?
     ORDER BY rank
     LIMIT ?`,
    [query, limit],
  );

  if (rows.length === 0) {
    return { content: [{ type: 'text', text: `No articles found for "${query}".` }] };
  }

  // Fetch summaries for matched articles.
  const results: string[] = [];
  for (const row of rows) {
    const summary = await dbGet<{ summary_text: string }>(
      ctx.db,
      `SELECT summary_text FROM article_summaries WHERE article_id = ? ORDER BY created_at DESC LIMIT 1`,
      [row.article_id],
    );
    const score = await dbGet<{ score: number }>(
      ctx.db,
      `SELECT score FROM article_scores WHERE article_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1`,
      [row.article_id, ctx.userId],
    );

    const date = row.published_at ? new Date(row.published_at).toISOString().slice(0, 10) : 'Unknown date';
    results.push(
      `**${row.title}** (${date}, score: ${score?.score ?? '?'}/5)\nID: ${row.article_id}\nURL: ${row.canonical_url}${summary?.summary_text ? `\nSummary: ${summary.summary_text}` : ''}`,
    );
  }

  return { content: [{ type: 'text', text: results.join('\n\n---\n\n') }] };
}

async function getArticle(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const articleId = String(args.article_id ?? '');

  const article = await dbGet<{
    id: string; title: string; canonical_url: string;
    content_text: string | null; published_at: number | null;
    author: string | null;
  }>(
    ctx.db,
    `SELECT id, title, canonical_url, content_text, published_at, author FROM articles WHERE id = ?`,
    [articleId],
  );

  if (!article) {
    return { content: [{ type: 'text', text: `Article not found: ${articleId}` }] };
  }

  const [summary, keyPoints, tags] = await Promise.all([
    dbGet<{ summary_text: string }>(ctx.db, `SELECT summary_text FROM article_summaries WHERE article_id = ? ORDER BY created_at DESC LIMIT 1`, [articleId]),
    dbGet<{ key_points_json: string }>(ctx.db, `SELECT key_points_json FROM article_key_points WHERE article_id = ? ORDER BY created_at DESC LIMIT 1`, [articleId]),
    dbAll<{ name: string }>(ctx.db, `SELECT t.name FROM tags t JOIN article_tags at2 ON at2.tag_id = t.id WHERE at2.article_id = ? LIMIT 10`, [articleId]),
  ]);

  let text = `# ${article.title}\n\n`;
  text += `**URL:** ${article.canonical_url}\n`;
  if (article.author) text += `**Author:** ${article.author}\n`;
  if (article.published_at) text += `**Published:** ${new Date(article.published_at).toISOString().slice(0, 10)}\n`;
  if (tags.length > 0) text += `**Tags:** ${tags.map(t => t.name).join(', ')}\n`;

  if (summary?.summary_text) text += `\n## Summary\n${summary.summary_text}\n`;

  if (keyPoints?.key_points_json) {
    try {
      const points = JSON.parse(keyPoints.key_points_json);
      if (Array.isArray(points) && points.length > 0) {
        text += `\n## Key Points\n${points.map((p: string) => `- ${p}`).join('\n')}\n`;
      }
    } catch { /* ignore */ }
  }

  if (article.content_text) {
    const truncated = article.content_text.length > 8000
      ? article.content_text.slice(0, 8000) + '\n\n[Content truncated]'
      : article.content_text;
    text += `\n## Content\n${truncated}`;
  }

  return { content: [{ type: 'text', text }] };
}

async function getBrief(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const brief = await dbGet<{
    brief_text: string; edition_type: string; created_at: number;
  }>(
    ctx.db,
    `SELECT brief_text, edition_type, created_at FROM news_brief_editions
     WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`,
    [ctx.userId],
  );

  if (!brief) {
    return { content: [{ type: 'text', text: 'No news brief available yet. Use the NebularNews app to generate one.' }] };
  }

  const date = new Date(brief.created_at).toISOString().slice(0, 16).replace('T', ' ');
  let text = `# News Brief (${brief.edition_type ?? 'latest'} — ${date})\n\n`;

  try {
    const bullets = JSON.parse(brief.brief_text);
    if (Array.isArray(bullets)) {
      for (const b of bullets) {
        text += `- ${b.text ?? b}\n`;
      }
    } else {
      text += brief.brief_text;
    }
  } catch {
    text += brief.brief_text;
  }

  return { content: [{ type: 'text', text }] };
}

async function listFeeds(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const includePaused = args.include_paused === true;

  const feeds = await dbAll<{
    id: string; title: string; site_url: string | null;
    feed_url: string; paused: number;
  }>(
    ctx.db,
    `SELECT f.id, f.title, f.site_url, f.feed_url, COALESCE(ufs.paused, 0) AS paused
     FROM feeds f
     JOIN user_feed_subscriptions ufs ON ufs.feed_id = f.id AND ufs.user_id = ?
     ${includePaused ? '' : 'WHERE COALESCE(ufs.paused, 0) = 0'}
     ORDER BY f.title ASC`,
    [ctx.userId],
  );

  if (feeds.length === 0) {
    return { content: [{ type: 'text', text: 'No feed subscriptions found.' }] };
  }

  const lines = feeds.map(f =>
    `- **${f.title}** ${f.paused ? '(paused)' : ''}\n  ${f.site_url ?? f.feed_url}`,
  );

  return { content: [{ type: 'text', text: `# Your Feeds (${feeds.length})\n\n${lines.join('\n')}` }] };
}

async function askAboutNews(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const question = String(args.question ?? '');
  if (!question) {
    return { content: [{ type: 'text', text: 'Please provide a question.' }] };
  }

  const ai = await resolveAIKey(ctx.db, ctx.userId, ctx.req, ctx.env);
  if (!ai) {
    return { content: [{ type: 'text', text: 'No AI provider configured. Add an API key in the NebularNews app.' }] };
  }

  // Gather top 5 recent scored articles.
  const articles = await dbAll<{
    id: string; title: string; content_text: string | null;
  }>(
    ctx.db,
    `SELECT a.id, a.title, a.content_text
     FROM articles a
     JOIN article_scores sc ON sc.article_id = a.id AND sc.user_id = ?
     ORDER BY sc.score DESC, a.published_at DESC
     LIMIT 5`,
    [ctx.userId],
  );

  const contextParts: string[] = [];
  for (const a of articles) {
    const summary = await dbGet<{ summary_text: string }>(
      ctx.db,
      `SELECT summary_text FROM article_summaries WHERE article_id = ? ORDER BY created_at DESC LIMIT 1`,
      [a.id],
    );
    const content = a.content_text?.slice(0, 2000) ?? '';
    contextParts.push(
      `**${a.title ?? 'Untitled'}**\n${summary?.summary_text ? `Summary: ${summary.summary_text}\n` : ''}Content: ${content}`,
    );
  }

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `You are an expert news analyst. Answer the user's question based on their recent articles. Be concise and cite articles by title.`,
    },
    { role: 'user', content: `Articles:\n\n${contextParts.join('\n\n---\n\n')}\n\nQuestion: ${question}` },
  ];

  const { content } = await runChat(ai.provider, ai.apiKey, ai.model, messages, { maxTokens: 1024 });

  return { content: [{ type: 'text', text: content }] };
}

async function getArticleSummary(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const articleId = String(args.article_id ?? '');

  const article = await dbGet<{ title: string }>(ctx.db, `SELECT title FROM articles WHERE id = ?`, [articleId]);
  if (!article) {
    return { content: [{ type: 'text', text: `Article not found: ${articleId}` }] };
  }

  const summary = await dbGet<{ summary_text: string; provider: string; model: string }>(
    ctx.db,
    `SELECT summary_text, provider, model FROM article_summaries WHERE article_id = ? ORDER BY created_at DESC LIMIT 1`,
    [articleId],
  );

  if (!summary) {
    return { content: [{ type: 'text', text: `No summary available for "${article.title}". Open the article in NebularNews to generate one.` }] };
  }

  return { content: [{ type: 'text', text: `**${article.title}**\n\n${summary.summary_text}` }] };
}

async function saveArticle(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const articleId = String(args.article_id ?? '');

  const article = await dbGet<{ title: string }>(ctx.db, `SELECT title FROM articles WHERE id = ?`, [articleId]);
  if (!article) {
    return { content: [{ type: 'text', text: `Article not found: ${articleId}` }] };
  }

  const now = Date.now();
  await dbGet(
    ctx.db,
    `INSERT INTO article_read_state (user_id, article_id, is_read, updated_at, saved_at)
     VALUES (?, ?, 0, ?, ?)
     ON CONFLICT(user_id, article_id) DO UPDATE SET saved_at = excluded.saved_at, updated_at = excluded.updated_at`,
    [ctx.userId, articleId, now, now],
  );

  return { content: [{ type: 'text', text: `Saved "${article.title}" to your bookmarks.` }] };
}

async function getTrendingTopics(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const windowHours = Number(args.window_hours) || 24;
  const since = Date.now() - windowHours * 60 * 60 * 1000;

  // Count articles per tag in the window.
  const trends = await dbAll<{ name: string; article_count: number }>(
    ctx.db,
    `SELECT t.name, COUNT(DISTINCT at2.article_id) AS article_count
     FROM tags t
     JOIN article_tags at2 ON at2.tag_id = t.id
     JOIN articles a ON a.id = at2.article_id
     JOIN user_feed_subscriptions ufs ON ufs.feed_id = a.feed_id AND ufs.user_id = ?
     WHERE a.published_at >= ? OR a.fetched_at >= ?
     GROUP BY t.id
     HAVING article_count >= 2
     ORDER BY article_count DESC
     LIMIT 10`,
    [ctx.userId, since, since],
  );

  if (trends.length === 0) {
    return { content: [{ type: 'text', text: `No trending topics in the last ${windowHours} hours.` }] };
  }

  const lines = trends.map(t => `- **${t.name}** — ${t.article_count} articles`);
  return { content: [{ type: 'text', text: `# Trending Topics (last ${windowHours}h)\n\n${lines.join('\n')}` }] };
}
