import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { dbAll, dbGet, dbRun } from '../db/helpers';
import { nanoid } from 'nanoid';
import { scrapeAndExtract } from '../lib/scraper';

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
const sourceNameExpr = `(SELECT COALESCE(f.title, f.url) FROM article_sources src JOIN feeds f ON f.id = src.feed_id WHERE src.article_id = a.id LIMIT 1)`;
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

  return c.json({ ok: true, data: { articles, total, limit, offset } });
});

// ── GET /articles/:id ────────────────────────────────────────────────────────

articleRoutes.get('/articles/:id', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  const articleId = c.req.param('id');

  const articleRow = await dbGet<Record<string, unknown>>(db,
    `SELECT a.id, a.canonical_url, a.title, a.author, a.published_at, a.fetched_at,
       a.content_html, a.content_text, a.excerpt, a.word_count, a.image_url, a.status
     FROM articles a WHERE a.id = ?`,
    [articleId]);

  if (!articleRow) return c.json({ ok: false, error: { code: 'not_found', message: 'Article not found' } }, 404);

  // Parallel lookups for nested sub-objects
  const [summaryRow, keyPointsRow, scoreRow, reactionRow, feedbackRows, sourceRow, sourcesRows, tags, tagSuggestions, readStateRow, highlightRows, annotationRow] = await Promise.all([
    dbGet<{ summary_text: string; provider: string | null; model: string | null; created_at: number }>(db,
      `SELECT summary_text, provider, model, created_at FROM article_summaries WHERE article_id = ? ORDER BY created_at DESC LIMIT 1`,
      [articleId]),
    dbGet<{ key_points_json: string; provider: string | null; model: string | null; created_at: number }>(db,
      `SELECT key_points_json, provider, model, created_at FROM article_key_points WHERE article_id = ? ORDER BY created_at DESC LIMIT 1`,
      [articleId]),
    dbGet<{ score: number; label: string | null; reason_text: string | null; evidence_json: string | null; score_status: string | null; confidence: number | null; scoring_method: string | null; created_at: number }>(db,
      `SELECT score, label, reason_text, evidence_json, score_status, confidence, scoring_method, created_at
       FROM article_scores WHERE article_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1`,
      [articleId, userId]),
    dbGet<{ article_id: string; feed_id: string; value: number; created_at: number }>(db,
      `SELECT article_id, feed_id, value, created_at FROM article_reactions WHERE article_id = ? AND user_id = ? LIMIT 1`,
      [articleId, userId]),
    dbAll<Record<string, unknown>>(db,
      `SELECT * FROM article_feedback WHERE article_id = ? AND user_id = ? ORDER BY created_at DESC`,
      [articleId, userId]),
    dbGet<{ feed_id: string; feed_title: string | null; site_url: string | null; feed_url: string | null }>(db,
      `SELECT src.feed_id, f.title as feed_title, f.site_url, f.url as feed_url
       FROM article_sources src JOIN feeds f ON f.id = src.feed_id
       WHERE src.article_id = ? LIMIT 1`,
      [articleId]),
    dbAll<{ feed_id: string; feed_title: string | null; site_url: string | null; feed_url: string | null }>(db,
      `SELECT src.feed_id, f.title as feed_title, f.site_url, f.url as feed_url
       FROM article_sources src JOIN feeds f ON f.id = src.feed_id
       WHERE src.article_id = ?`,
      [articleId]),
    dbAll<{ id: string; name: string }>(db,
      `SELECT t.id, t.name FROM tags t
       JOIN article_tags at2 ON at2.tag_id = t.id
       WHERE at2.article_id = ? AND at2.user_id = ?
       ORDER BY t.name`,
      [articleId, userId]),
    dbAll<{ id: string; name: string; confidence: number | null }>(db,
      `SELECT id, name, confidence FROM article_tag_suggestions
       WHERE article_id = ? AND user_id = ?
       ORDER BY confidence DESC`,
      [articleId, userId]),
    dbGet<{ is_read: number; saved_at: number | null }>(db,
      `SELECT is_read, saved_at FROM article_read_state WHERE article_id = ? AND user_id = ? LIMIT 1`,
      [articleId, userId]),
    dbAll<{ id: string; selected_text: string; block_index: number | null; text_offset: number | null; text_length: number | null; note: string | null; color: string; created_at: number; updated_at: number }>(db,
      `SELECT id, selected_text, block_index, text_offset, text_length, note, color, created_at, updated_at
       FROM article_highlights WHERE article_id = ? AND user_id = ?
       ORDER BY block_index, text_offset, created_at`,
      [articleId, userId]),
    dbGet<{ id: string; content: string; created_at: number; updated_at: number }>(db,
      `SELECT id, content, created_at, updated_at FROM article_annotations
       WHERE article_id = ? AND user_id = ?`,
      [articleId, userId]),
  ]);

  // Fetch reaction reason codes if reaction exists
  let reactionReasonCodes: string[] = [];
  if (reactionRow) {
    const reasons = await dbAll<{ reason_code: string }>(db,
      `SELECT reason_code FROM article_reaction_reasons WHERE article_id = ? AND user_id = ?`,
      [articleId, userId]);
    reactionReasonCodes = reasons.map((r) => r.reason_code);
  }

  return c.json({
    ok: true,
    data: {
      article: articleRow,
      summary: summaryRow ? { summary_text: summaryRow.summary_text, provider: summaryRow.provider, model: summaryRow.model, created_at: summaryRow.created_at } : null,
      key_points: keyPointsRow ? { key_points_json: keyPointsRow.key_points_json, provider: keyPointsRow.provider, model: keyPointsRow.model, created_at: keyPointsRow.created_at } : null,
      score: scoreRow ? { score: scoreRow.score, label: scoreRow.label, reason_text: scoreRow.reason_text, evidence_json: scoreRow.evidence_json, score_status: scoreRow.score_status, confidence: scoreRow.confidence, scoring_method: scoreRow.scoring_method, created_at: scoreRow.created_at } : null,
      feedback: feedbackRows,
      reaction: reactionRow ? { article_id: reactionRow.article_id, feed_id: reactionRow.feed_id, value: reactionRow.value, created_at: reactionRow.created_at, reason_codes: reactionReasonCodes } : null,
      preferred_source: sourceRow ? { feed_id: sourceRow.feed_id, feed_title: sourceRow.feed_title, site_url: sourceRow.site_url, feed_url: sourceRow.feed_url } : null,
      sources: sourcesRows.map((s) => ({ feed_id: s.feed_id, feed_title: s.feed_title, site_url: s.site_url, feed_url: s.feed_url })),
      tags,
      tag_suggestions: tagSuggestions,
      is_read: readStateRow?.is_read ?? 0,
      saved_at: readStateRow?.saved_at ?? null,
      highlights: highlightRows,
      annotation: annotationRow ?? null,
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

  return c.json({ ok: true, data: { article_id: c.req.param('id'), saved, saved_at: saved ? now : null } });
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

  return c.json({ ok: true, data: { article_id: articleId, value, reason_codes: reasonCodes } });
});

// ---------------------------------------------------------------------------
// POST /articles/clip — save any URL as an article (web clipper)
// ---------------------------------------------------------------------------

articleRoutes.post('/articles/clip', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;

  const body = await c.req.json<{ url: string }>();
  const url = body.url?.trim();
  if (!url) {
    return c.json({ ok: false, error: { code: 'bad_request', message: 'url is required' } }, 400);
  }

  const now = Date.now();

  // Find or create the user's Web Clips feed.
  const clipFeedUrl = `clip://${userId}`;
  let clipFeed = await dbGet<{ id: string }>(
    db,
    `SELECT id FROM feeds WHERE url = ? AND feed_type = 'web_clip'`,
    [clipFeedUrl],
  );

  if (!clipFeed) {
    const feedId = nanoid();
    await dbRun(
      db,
      `INSERT INTO feeds (id, url, title, feed_type, scrape_mode, disabled, created_at)
       VALUES (?, ?, 'Web Clips', 'web_clip', 'rss_only', 0, ?)`,
      [feedId, clipFeedUrl, now],
    );
    clipFeed = { id: feedId };

    await dbRun(
      db,
      `INSERT OR IGNORE INTO user_feed_subscriptions (id, user_id, feed_id, paused, created_at, updated_at)
       VALUES (?, ?, ?, 0, ?, ?)`,
      [nanoid(), userId, clipFeed.id, now, now],
    );
  }

  // Check if article already exists.
  let article = await dbGet<{ id: string; title: string }>(
    db,
    `SELECT id, title FROM articles WHERE canonical_url = ?`,
    [url],
  );

  if (!article) {
    // Scrape the URL.
    try {
      const result = await scrapeAndExtract(url, c.env);

      const articleId = nanoid();
      await dbRun(
        db,
        `INSERT INTO articles (id, canonical_url, title, author, content_html, content_text, excerpt, word_count, image_url, extraction_method, extraction_quality, fetched_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          articleId, url,
          result.title ?? url, result.author,
          result.contentHtml, result.contentText, result.excerpt,
          result.wordCount, result.imageUrl,
          result.extractionMethod, result.extractionQuality,
          now, now,
        ],
      );
      article = { id: articleId, title: result.title ?? url };
    } catch (err) {
      // Scraping failed — create a minimal article with just the URL.
      const articleId = nanoid();
      await dbRun(
        db,
        `INSERT INTO articles (id, canonical_url, title, fetched_at, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [articleId, url, url, now, now],
      );
      article = { id: articleId, title: url };
    }
  }

  // Link to web clips feed.
  await dbRun(
    db,
    `INSERT OR IGNORE INTO article_sources (id, article_id, feed_id, item_guid, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [nanoid(), article.id, clipFeed.id, url, now],
  );

  // Auto-save the article.
  await dbRun(
    db,
    `INSERT INTO user_article_states (id, user_id, article_id, saved_at, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, article_id) DO UPDATE SET saved_at = ?`,
    [nanoid(), userId, article.id, now, now, now],
  );

  return c.json({ ok: true, data: { article_id: article.id, title: article.title } });
});
