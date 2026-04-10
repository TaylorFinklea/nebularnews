import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { dbAll, dbGet, dbRun } from '../db/helpers';
import { nanoid } from 'nanoid';

export const articleRoutes = new Hono<AppEnv>();

// ── Helpers ──────────────────────────────────────────────────────────────────

const esc = (uid: string) => uid.replace(/'/g, "''");
const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(', ');

// User-scoped subquery expressions (userId embedded as literal — safe, server-generated)
const scoreExpr = (uid: string) => `COALESCE(
  (SELECT score FROM article_score_overrides WHERE article_id = a.id AND user_id = '${esc(uid)}' LIMIT 1),
  (SELECT score FROM article_scores WHERE article_id = a.id AND user_id = '${esc(uid)}' AND score_status = 'ready' ORDER BY created_at DESC LIMIT 1)
)`;
const scoreLabelExpr = (uid: string) => `COALESCE(
  (SELECT 'User corrected' FROM article_score_overrides WHERE article_id = a.id AND user_id = '${esc(uid)}' LIMIT 1),
  (SELECT label FROM article_scores WHERE article_id = a.id AND user_id = '${esc(uid)}' ORDER BY created_at DESC LIMIT 1)
)`;
const scoreMethodExpr = (uid: string) =>
  `(SELECT scoring_method FROM article_scores WHERE article_id = a.id AND user_id = '${esc(uid)}' ORDER BY created_at DESC LIMIT 1)`;
const readExpr = (uid: string) => `COALESCE(
  (SELECT is_read FROM article_read_state WHERE article_id = a.id AND user_id = '${esc(uid)}' LIMIT 1), 0
)`;
const reactionExpr = (uid: string) =>
  `(SELECT value FROM article_reactions WHERE article_id = a.id AND user_id = '${esc(uid)}' LIMIT 1)`;
const savedExpr = (uid: string) =>
  `(SELECT saved_at FROM article_read_state WHERE article_id = a.id AND user_id = '${esc(uid)}' LIMIT 1)`;
const subFilter = (uid: string) => `EXISTS (
  SELECT 1 FROM article_sources src
  JOIN user_feed_subscriptions ufs ON ufs.feed_id = src.feed_id
  WHERE src.article_id = a.id AND ufs.user_id = '${esc(uid)}'
)`;
const sourceNameExpr = `(SELECT f.title FROM article_sources src JOIN feeds f ON f.id = src.feed_id WHERE src.article_id = a.id LIMIT 1)`;
const sourceFeedIdExpr = `(SELECT src.feed_id FROM article_sources src WHERE src.article_id = a.id LIMIT 1)`;

// ── GET /articles ────────────────────────────────────────────────────────────

articleRoutes.get('/articles', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;

  const query = c.req.query('query')?.trim() ?? '';
  const offset = parseInt(c.req.query('offset') ?? '0', 10);
  const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10), 100);
  const readFilter = c.req.query('read') ?? 'all';
  const minScore = c.req.query('minScore') ? parseInt(c.req.query('minScore')!, 10) : null;
  const sort = c.req.query('sort') ?? 'newest';
  const tag = c.req.query('tag') ?? null;
  const saved = c.req.query('saved') === 'true';

  const conditions: string[] = [subFilter(userId)];
  const params: unknown[] = [];

  // FTS5 search
  if (query) {
    const sanitized = (query.toLowerCase().match(/\w+/g) ?? []).join(' ');
    conditions.push(`a.id IN (SELECT article_id FROM article_search WHERE article_search MATCH ?)`);
    params.push(sanitized || query);
  }

  // Read filter
  if (readFilter === 'unread') conditions.push(`${readExpr(userId)} = 0`);
  if (readFilter === 'read') conditions.push(`${readExpr(userId)} = 1`);

  // Min score
  if (minScore !== null) {
    conditions.push(`${scoreExpr(userId)} >= ?`);
    params.push(minScore);
  }

  // Tag filter
  if (tag) {
    conditions.push(`EXISTS (SELECT 1 FROM article_tags at2 JOIN tags t ON t.id = at2.tag_id
      WHERE at2.article_id = a.id AND at2.user_id = '${esc(userId)}' AND t.slug = ?)`);
    params.push(tag);
  }

  // Saved filter
  if (saved) {
    conditions.push(`${savedExpr(userId)} IS NOT NULL`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Sort
  let orderBy: string;
  switch (sort) {
    case 'oldest': orderBy = 'COALESCE(a.published_at, a.fetched_at) ASC'; break;
    case 'score_desc': orderBy = `${scoreExpr(userId)} DESC NULLS LAST, a.published_at DESC`; break;
    case 'score_asc': orderBy = `${scoreExpr(userId)} ASC NULLS LAST, a.published_at DESC`; break;
    default: orderBy = 'COALESCE(a.published_at, a.fetched_at) DESC'; break;
  }

  // Count
  const countRow = await dbGet<{ count: number }>(db,
    `SELECT COUNT(*) as count FROM articles a ${where}`, params);
  const total = countRow?.count ?? 0;

  // Fetch articles
  const articles = await dbAll<Record<string, unknown>>(db,
    `SELECT
      a.id, a.canonical_url, a.title, a.author, a.published_at, a.fetched_at,
      a.excerpt, a.word_count, a.image_url,
      ${readExpr(userId)} as is_read,
      ${reactionExpr(userId)} as reaction_value,
      ${savedExpr(userId)} as saved_at,
      ${scoreExpr(userId)} as score,
      ${scoreLabelExpr(userId)} as score_label,
      ${scoreMethodExpr(userId)} as scoring_method,
      ${sourceNameExpr} as source_name,
      ${sourceFeedIdExpr} as source_feed_id,
      (SELECT summary_text FROM article_summaries WHERE article_id = a.id ORDER BY created_at DESC LIMIT 1) as summary_text
    FROM articles a
    ${where}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?`,
    [...params, limit, offset]);

  return c.json({ ok: true, data: { articles, total } });
});

// ── GET /articles/:id ────────────────────────────────────────────────────────

articleRoutes.get('/articles/:id', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  const articleId = c.req.param('id');

  const article = await dbGet<Record<string, unknown>>(db,
    `SELECT
      a.*,
      ${readExpr(userId)} as is_read,
      ${reactionExpr(userId)} as reaction_value,
      ${savedExpr(userId)} as saved_at,
      ${scoreExpr(userId)} as score,
      ${scoreLabelExpr(userId)} as score_label,
      ${scoreMethodExpr(userId)} as scoring_method,
      ${sourceNameExpr} as source_name,
      ${sourceFeedIdExpr} as source_feed_id
    FROM articles a WHERE a.id = ?`,
    [articleId]);

  if (!article) return c.json({ ok: false, error: { code: 'not_found', message: 'Article not found' } }, 404);

  // Parallel lookups
  const [summary, keyPoints, tags, tagSuggestions] = await Promise.all([
    dbGet<{ summary_text: string }>(db,
      `SELECT summary_text FROM article_summaries WHERE article_id = ? ORDER BY created_at DESC LIMIT 1`,
      [articleId]),
    dbGet<{ key_points_json: string }>(db,
      `SELECT key_points_json FROM article_key_points WHERE article_id = ? ORDER BY created_at DESC LIMIT 1`,
      [articleId]),
    dbAll<{ id: string; name: string; slug: string }>(db,
      `SELECT t.id, t.name, t.slug FROM tags t
       JOIN article_tags at2 ON at2.tag_id = t.id
       WHERE at2.article_id = ? AND at2.user_id = ?
       ORDER BY t.name`,
      [articleId, userId]),
    dbAll<{ name: string; confidence: number | null }>(db,
      `SELECT name, confidence FROM article_tag_suggestions
       WHERE article_id = ? AND user_id = ?
       ORDER BY confidence DESC`,
      [articleId, userId]),
  ]);

  return c.json({
    ok: true,
    data: {
      ...article,
      summary_text: summary?.summary_text ?? null,
      key_points: keyPoints?.key_points_json ? JSON.parse(keyPoints.key_points_json) : [],
      tags,
      tag_suggestions: tagSuggestions,
    },
  });
});

// ���─ POST /articles/:id/read ─────────────────────────────────────────────────

articleRoutes.post('/articles/:id/read', async (c) => {
  const userId = c.get('userId');
  const { isRead } = await c.req.json<{ isRead: boolean }>();
  const now = Date.now();

  await dbRun(c.env.DB,
    `INSERT INTO article_read_state (user_id, article_id, is_read, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (user_id, article_id) DO UPDATE SET is_read = excluded.is_read, updated_at = excluded.updated_at`,
    [userId, c.req.param('id'), isRead ? 1 : 0, now]);

  return c.json({ ok: true, data: { isRead } });
});

// ── POST /articles/:id/save ──────────────────────────��──────────────────────

articleRoutes.post('/articles/:id/save', async (c) => {
  const userId = c.get('userId');
  const { saved } = await c.req.json<{ saved: boolean }>();
  const now = Date.now();

  await dbRun(c.env.DB,
    `INSERT INTO article_read_state (user_id, article_id, is_read, updated_at, saved_at)
     VALUES (?, ?, 0, ?, ?)
     ON CONFLICT (user_id, article_id) DO UPDATE SET saved_at = excluded.saved_at, updated_at = excluded.updated_at`,
    [userId, c.req.param('id'), now, saved ? now : null]);

  return c.json({ ok: true, data: { saved } });
});

// ── POST /articles/:id/dismiss ──────────────────────────────────────────────

articleRoutes.post('/articles/:id/dismiss', async (c) => {
  const userId = c.get('userId');
  const now = Date.now();

  await dbRun(c.env.DB,
    `INSERT INTO article_read_state (user_id, article_id, is_read, updated_at)
     VALUES (?, ?, 1, ?)
     ON CONFLICT (user_id, article_id) DO UPDATE SET is_read = 1, updated_at = excluded.updated_at`,
    [userId, c.req.param('id'), now]);

  return c.json({ ok: true, data: { dismissed: true } });
});

// ── POST /articles/:id/reaction ──────────────────────────────��──────────────

articleRoutes.post('/articles/:id/reaction', async (c) => {
  const userId = c.get('userId');
  const articleId = c.req.param('id');
  const { value, reasonCodes } = await c.req.json<{ value: number; reasonCodes: string[] }>();
  const now = Date.now();
  const db = c.env.DB;

  // Need feed_id for the reaction
  const source = await dbGet<{ feed_id: string }>(db,
    `SELECT feed_id FROM article_sources WHERE article_id = ? LIMIT 1`, [articleId]);

  if (!source) return c.json({ ok: false, error: { code: 'not_found', message: 'Article source not found' } }, 404);

  await dbRun(db,
    `INSERT INTO article_reactions (id, user_id, article_id, feed_id, value, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, article_id) DO UPDATE SET value = excluded.value, created_at = excluded.created_at`,
    [nanoid(), userId, articleId, source.feed_id, value, now]);

  // Upsert reason codes
  if (reasonCodes.length > 0) {
    // Clear old reasons
    await dbRun(db,
      `DELETE FROM article_reaction_reasons WHERE user_id = ? AND article_id = ?`,
      [userId, articleId]);
    for (const code of reasonCodes) {
      await dbRun(db,
        `INSERT OR IGNORE INTO article_reaction_reasons (user_id, article_id, reason_code, created_at)
         VALUES (?, ?, ?, ?)`,
        [userId, articleId, code, now]);
    }
  }

  return c.json({ ok: true, data: { value, reasonCodes } });
});
