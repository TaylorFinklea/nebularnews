import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { dbAll, dbGet } from '../db/helpers';

export const articleRoutes = new Hono<AppEnv>();

// Minimal Phase-1 surface: just enough for an admin/dashboard to list and
// inspect articles. The MCP tools (`search_articles`, `get_article`,
// `get_recent`) cover the LLM-facing retrieval; these HTTP endpoints exist
// for the future web dashboard.

const subFilter = (uid: string) => {
  const esc = uid.replace(/'/g, "''");
  return `EXISTS (
    SELECT 1 FROM article_sources src
    JOIN user_feed_subscriptions ufs ON ufs.feed_id = src.feed_id
    WHERE src.article_id = a.id AND ufs.user_id = '${esc}'
  )`;
};

const sourceNameExpr = `(SELECT COALESCE(f.title, f.url) FROM article_sources src JOIN feeds f ON f.id = src.feed_id WHERE src.article_id = a.id LIMIT 1)`;
const sourceFeedIdExpr = `(SELECT src.feed_id FROM article_sources src WHERE src.article_id = a.id LIMIT 1)`;

// GET /articles — paginated list across the user's subscribed feeds
articleRoutes.get('/articles', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;

  const query = c.req.query('query')?.trim() ?? '';
  const offset = parseInt(c.req.query('offset') ?? '0', 10);
  const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10), 100);
  const sort = c.req.query('sort') ?? 'newest';

  const conditions: string[] = [subFilter(userId), 'a.quarantined_at IS NULL'];
  const params: unknown[] = [];

  if (query) {
    const sanitized = (query.toLowerCase().match(/\w+/g) ?? []).join(' ');
    conditions.push(`a.id IN (SELECT article_id FROM article_search WHERE article_search MATCH ?)`);
    params.push(sanitized || query);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;
  const orderBy = sort === 'oldest'
    ? 'COALESCE(a.published_at, a.fetched_at) ASC'
    : 'COALESCE(a.published_at, a.fetched_at) DESC';

  const countRow = await dbGet<{ count: number }>(
    db,
    `SELECT COUNT(*) as count FROM articles a ${where}`,
    params,
  );
  const total = countRow?.count ?? 0;

  const articles = await dbAll<Record<string, unknown>>(
    db,
    `SELECT
      a.id, a.canonical_url, a.title, a.author, a.published_at, a.fetched_at,
      a.excerpt, a.word_count, a.image_url,
      ${sourceNameExpr} as source_name,
      ${sourceFeedIdExpr} as source_feed_id
    FROM articles a
    ${where}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  return c.json({ ok: true, data: { articles, total, limit, offset } });
});

// GET /articles/:id — full article detail (content + sources + tags)
articleRoutes.get('/articles/:id', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  const articleId = c.req.param('id');

  const articleRow = await dbGet<Record<string, unknown>>(
    db,
    `SELECT a.id, a.canonical_url, a.title, a.author, a.published_at, a.fetched_at,
       a.content_html, a.content_text, a.excerpt, a.word_count, a.image_url,
       a.extraction_method, a.extraction_quality,
       a.last_fetch_attempt_at, a.fetch_attempt_count, a.last_fetch_error
     FROM articles a WHERE a.id = ?`,
    [articleId],
  );

  if (!articleRow) {
    return c.json({ ok: false, error: { code: 'not_found', message: 'Article not found' } }, 404);
  }

  const [sourcesRows, tags] = await Promise.all([
    dbAll<{ feed_id: string; feed_title: string | null; site_url: string | null; feed_url: string | null }>(
      db,
      `SELECT src.feed_id, f.title as feed_title, f.site_url, f.url as feed_url
       FROM article_sources src JOIN feeds f ON f.id = src.feed_id
       WHERE src.article_id = ?`,
      [articleId],
    ),
    dbAll<{ id: string; name: string }>(
      db,
      `SELECT t.id, t.name FROM tags t
       JOIN article_tags at2 ON at2.tag_id = t.id
       WHERE at2.article_id = ? AND at2.user_id = ?
       ORDER BY t.name`,
      [articleId, userId],
    ),
  ]);

  return c.json({
    ok: true,
    data: {
      article: articleRow,
      sources: sourcesRows.map((s) => ({
        feed_id: s.feed_id,
        feed_title: s.feed_title,
        site_url: s.site_url,
        feed_url: s.feed_url,
      })),
      tags,
    },
  });
});
