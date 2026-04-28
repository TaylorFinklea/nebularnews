import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import type { AppEnv } from '../index';
import { dbGet, dbAll, dbRun } from '../db/helpers';
import { scrapeAndPersist, type ScrapeProvider } from '../lib/scraper';
import { persistBrief } from '../lib/brief-persist';
import { sendPushToUser } from '../lib/apns';
import { resolveAIKey } from '../lib/ai-key-resolver';
import { runChat, parseJsonResponse } from '../lib/ai';
import { buildNewsBriefPrompt } from '../lib/prompts';

const ALLOWED_SCRAPE_MODES = new Set(['rss_only', 'auto_fetch_on_empty', 'always']);

const AUDITED_METHODS = new Set(['POST', 'PATCH', 'DELETE']);

export const adminRoutes = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// Admin middleware — check is_admin flag
// ---------------------------------------------------------------------------

adminRoutes.use('*', async (c, next) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  const user = await dbGet<{ is_admin: number }>(db, `SELECT is_admin FROM user WHERE id = ?`, [userId]);
  if (!user || user.is_admin !== 1) {
    return c.json({ ok: false, error: { code: 'forbidden', message: 'Admin access required' } }, 403);
  }
  await next();
});

// ---------------------------------------------------------------------------
// Audit middleware — logs every admin mutation
//
// Captures (user, method, path, params, body, status) for POST/PATCH/DELETE
// calls. Body capture clones the request before next() so handlers can still
// read it normally. The actual DB write is fire-and-forget via waitUntil so
// the response isn't blocked.
// ---------------------------------------------------------------------------

adminRoutes.use('*', async (c, next) => {
  if (!AUDITED_METHODS.has(c.req.method)) {
    await next();
    return;
  }

  // Capture body before the handler reads it. Hono lets handlers call
  // c.req.json() multiple times in some versions, but cloning is the safe
  // way to guarantee we don't consume the stream.
  let bodyText: string | null = null;
  try {
    bodyText = await c.req.raw.clone().text();
    if (bodyText && bodyText.length > 4000) bodyText = bodyText.slice(0, 4000) + '…';
  } catch { /* no body or unreadable — skip */ }

  await next();

  const userId = c.get('userId');
  const status = c.res.status;
  const requestId = c.res.headers.get('x-request-id') ?? null;
  const params = c.req.param();

  c.executionCtx.waitUntil(
    (async () => {
      try {
        await dbRun(
          c.env.DB,
          `INSERT INTO admin_audit
            (id, user_id, method, path, params_json, body_json, status_code, request_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            nanoid(),
            userId,
            c.req.method,
            new URL(c.req.url).pathname,
            Object.keys(params).length > 0 ? JSON.stringify(params) : null,
            bodyText,
            status,
            requestId,
            Date.now(),
          ],
        );
      } catch (err) {
        // Audit failures must not surface to the client. Log and move on.
        console.error('[admin-audit] failed to write row:', err);
      }
    })(),
  );
});

// ---------------------------------------------------------------------------
// GET /admin/audit — paginated audit log
//
// Filters: user_id, method (POST|PATCH|DELETE), path (prefix match), before
// (cursor), limit. Returns ordered by most-recent first. Web UI for this is
// design-blocked; the endpoint exists so the data is queryable now.
// ---------------------------------------------------------------------------

adminRoutes.get('/admin/audit', async (c) => {
  const db = c.env.DB;
  const userFilter = c.req.query('user_id');
  const methodFilter = c.req.query('method')?.toUpperCase();
  const pathPrefix = c.req.query('path');
  const limitRaw = parseInt(c.req.query('limit') ?? '50', 10);
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 50, 1), 200);
  const beforeRaw = c.req.query('before');
  const before = beforeRaw ? parseInt(beforeRaw, 10) : Number.MAX_SAFE_INTEGER;

  const conditions: string[] = ['created_at < ?'];
  const params: unknown[] = [before];
  if (userFilter) { conditions.push('user_id = ?'); params.push(userFilter); }
  if (methodFilter && AUDITED_METHODS.has(methodFilter)) { conditions.push('method = ?'); params.push(methodFilter); }
  if (pathPrefix) { conditions.push('path LIKE ?'); params.push(pathPrefix + '%'); }
  params.push(limit + 1);

  const rows = await dbAll<{
    id: string;
    user_id: string;
    method: string;
    path: string;
    params_json: string | null;
    body_json: string | null;
    status_code: number | null;
    request_id: string | null;
    created_at: number;
  }>(
    db,
    `SELECT id, user_id, method, path, params_json, body_json, status_code, request_id, created_at
       FROM admin_audit
      WHERE ${conditions.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT ?`,
    params,
  );

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextBefore = hasMore ? page[page.length - 1].created_at : null;
  return c.json({ ok: true, data: { entries: page, next_before: nextBefore } });
});

// ---------------------------------------------------------------------------
// GET /admin/users — list all users with stats
// ---------------------------------------------------------------------------

adminRoutes.get('/admin/users', async (c) => {
  const db = c.env.DB;

  const users = await dbAll<{
    id: string; name: string | null; email: string | null;
    is_admin: number; created_at: string;
  }>(db, `SELECT id, name, email, is_admin, createdAt as created_at FROM user ORDER BY createdAt DESC LIMIT 100`);

  const enriched = [];
  for (const u of users) {
    const [subRow, usageRow, feedCount, articleStates] = await Promise.all([
      dbGet<{ tier: string; expires_at: number }>(db, `SELECT tier, expires_at FROM user_subscriptions WHERE user_id = ? LIMIT 1`, [u.id]),
      dbGet<{ total_tokens: number }>(db, `SELECT COALESCE(SUM(tokens_input + tokens_output), 0) AS total_tokens FROM ai_usage WHERE user_id = ? AND created_at >= ?`, [u.id, Date.now() - 7 * 24 * 60 * 60 * 1000]),
      dbGet<{ cnt: number }>(db, `SELECT COUNT(*) AS cnt FROM user_feed_subscriptions WHERE user_id = ?`, [u.id]),
      dbGet<{ read_count: number; last_active: number | null }>(db, `SELECT COUNT(CASE WHEN is_read = 1 THEN 1 END) AS read_count, MAX(updated_at) AS last_active FROM article_read_state WHERE user_id = ?`, [u.id]),
    ]);

    enriched.push({
      id: u.id,
      name: u.name,
      email: u.email,
      is_admin: u.is_admin === 1,
      created_at: u.created_at,
      tier: subRow?.tier ?? null,
      subscription_expires: subRow?.expires_at ?? null,
      tokens_7d: usageRow?.total_tokens ?? 0,
      feed_count: feedCount?.cnt ?? 0,
      articles_read: articleStates?.read_count ?? 0,
      last_active: articleStates?.last_active ?? null,
    });
  }

  return c.json({ ok: true, data: enriched });
});

// ---------------------------------------------------------------------------
// POST /admin/users/:userId/role — set admin role
// ---------------------------------------------------------------------------

adminRoutes.post('/admin/users/:userId/role', async (c) => {
  const db = c.env.DB;
  const targetUserId = c.req.param('userId');
  const body = await c.req.json<{ is_admin: boolean }>();

  await dbRun(db, `UPDATE user SET is_admin = ? WHERE id = ?`, [body.is_admin ? 1 : 0, targetUserId]);
  return c.json({ ok: true, data: { userId: targetUserId, is_admin: body.is_admin } });
});

// ---------------------------------------------------------------------------
// GET /admin/feeds — all feeds with health stats
// ---------------------------------------------------------------------------

adminRoutes.get('/admin/feeds', async (c) => {
  const db = c.env.DB;

  const feeds = await dbAll<{
    id: string; title: string; url: string; feed_type: string;
    error_count: number; last_polled_at: number | null;
    scrape_mode: string; scrape_error_count: number;
    avg_extraction_quality: number | null;
    subscriber_count: number;
  }>(
    db,
    `SELECT f.id, COALESCE(f.title, f.url) AS title, f.url, f.feed_type, f.error_count, f.last_polled_at,
            f.scrape_mode, f.scrape_error_count, f.avg_extraction_quality,
            (SELECT COUNT(*) FROM user_feed_subscriptions ufs WHERE ufs.feed_id = f.id) AS subscriber_count
     FROM feeds f
     ORDER BY f.error_count DESC, f.title ASC
     LIMIT 200`,
  );

  return c.json({ ok: true, data: feeds });
});

// ---------------------------------------------------------------------------
// POST /admin/feeds/:feedId/repoll — force re-poll a feed
// ---------------------------------------------------------------------------

adminRoutes.post('/admin/feeds/:feedId/repoll', async (c) => {
  const db = c.env.DB;
  const feedId = c.req.param('feedId');

  await dbRun(db, `UPDATE feeds SET next_poll_at = 0, error_count = 0 WHERE id = ?`, [feedId]);
  return c.json({ ok: true, data: { feedId, message: 'Feed queued for next poll' } });
});

// ---------------------------------------------------------------------------
// PATCH /admin/feeds/:feedId — update feed-level settings
//
// Accepts any subset of { scrape_mode, disabled, title }. Unknown keys are
// ignored. Used by the web admin UI to flip a feed's scrape mode, pause a
// chronically-failing source, or correct a bad title.
// ---------------------------------------------------------------------------

adminRoutes.patch('/admin/feeds/:feedId', async (c) => {
  const db = c.env.DB;
  const feedId = c.req.param('feedId');
  const body = await c.req.json<{
    scrape_mode?: string;
    disabled?: boolean;
    title?: string;
  }>();

  const sets: string[] = [];
  const params: unknown[] = [];

  if (body.scrape_mode !== undefined) {
    if (!ALLOWED_SCRAPE_MODES.has(body.scrape_mode)) {
      return c.json({ ok: false, error: { code: 'bad_request', message: `scrape_mode must be one of ${[...ALLOWED_SCRAPE_MODES].join(', ')}` } }, 400);
    }
    sets.push('scrape_mode = ?');
    params.push(body.scrape_mode);
  }
  if (body.disabled !== undefined) {
    sets.push('disabled = ?');
    params.push(body.disabled ? 1 : 0);
  }
  if (body.title !== undefined) {
    sets.push('title = ?');
    params.push(body.title);
  }

  if (sets.length === 0) {
    return c.json({ ok: false, error: { code: 'bad_request', message: 'No updatable fields supplied' } }, 400);
  }

  params.push(feedId);
  await dbRun(db, `UPDATE feeds SET ${sets.join(', ')} WHERE id = ?`, params);

  const updated = await dbGet<Record<string, unknown>>(
    db,
    `SELECT id, url, title, site_url, scrape_mode, scrape_provider, disabled,
            error_count, scrape_error_count, avg_extraction_quality
       FROM feeds WHERE id = ?`,
    [feedId],
  );
  if (!updated) {
    return c.json({ ok: false, error: { code: 'not_found', message: 'Feed not found' } }, 404);
  }
  return c.json({ ok: true, data: updated });
});

// ---------------------------------------------------------------------------
// GET /admin/articles/:articleId — full detail for one article
//
// The list endpoint (/admin/articles) caps at 200 rows so anything older than
// that page falls off the radar. Admin pages need to fetch by id directly,
// joined with the originating feed (id + title + scrape_mode) so the detail
// page can deep-link back to feed admin without an extra round-trip.
// ---------------------------------------------------------------------------

adminRoutes.get('/admin/articles/:articleId', async (c) => {
  const db = c.env.DB;
  const articleId = c.req.param('articleId');

  const row = await dbGet<{
    id: string;
    title: string | null;
    canonical_url: string;
    excerpt: string | null;
    content_text: string | null;
    content_html: string | null;
    word_count: number | null;
    extraction_method: string | null;
    extraction_quality: number | null;
    published_at: number | null;
    fetched_at: number | null;
    last_fetch_attempt_at: number | null;
    fetch_attempt_count: number;
    last_fetch_error: string | null;
    scrape_retry_count: number;
    next_scrape_attempt_at: number | null;
    quarantined_at: number | null;
    feed_id: string | null;
    feed_title: string | null;
    feed_scrape_mode: string | null;
  }>(
    db,
    `SELECT a.id, a.title, a.canonical_url, a.excerpt, a.content_text, a.content_html,
            a.word_count, a.extraction_method, a.extraction_quality,
            a.published_at, a.fetched_at, a.last_fetch_attempt_at, a.fetch_attempt_count,
            a.last_fetch_error, a.scrape_retry_count, a.next_scrape_attempt_at,
            a.quarantined_at,
            (SELECT src.feed_id FROM article_sources src WHERE src.article_id = a.id LIMIT 1) AS feed_id,
            (SELECT f.title FROM article_sources src JOIN feeds f ON f.id = src.feed_id WHERE src.article_id = a.id LIMIT 1) AS feed_title,
            (SELECT f.scrape_mode FROM article_sources src JOIN feeds f ON f.id = src.feed_id WHERE src.article_id = a.id LIMIT 1) AS feed_scrape_mode
       FROM articles a
      WHERE a.id = ?`,
    [articleId],
  );

  if (!row) {
    return c.json({ ok: false, error: { code: 'not_found', message: 'Article not found' } }, 404);
  }

  return c.json({
    ok: true,
    data: {
      ...row,
      content_text_length: row.content_text ? row.content_text.length : 0,
    },
  });
});

// ---------------------------------------------------------------------------
// POST /admin/articles/:articleId/rescrape — force synchronous rescrape
//
// Resets retry bookkeeping so the cron will retry the article again later if
// this admin-triggered scrape also fails. Returns the refreshed article row.
// ---------------------------------------------------------------------------

adminRoutes.post('/admin/articles/:articleId/rescrape', async (c) => {
  const db = c.env.DB;
  const articleId = c.req.param('articleId');

  const article = await dbGet<{ id: string; canonical_url: string }>(
    db,
    `SELECT id, canonical_url FROM articles WHERE id = ?`,
    [articleId],
  );
  if (!article) {
    return c.json({ ok: false, error: { code: 'not_found', message: 'Article not found' } }, 404);
  }

  // Prefer the originating feed's configured scrape provider, if any.
  const feedRow = await dbGet<{ scrape_provider: string | null }>(
    db,
    `SELECT f.scrape_provider FROM article_sources src
       JOIN feeds f ON f.id = src.feed_id
      WHERE src.article_id = ? AND f.scrape_provider IS NOT NULL
      LIMIT 1`,
    [articleId],
  );

  // Reset retry/attempt counters AND clear quarantine so the admin action
  // starts with a fresh budget. If the rescrape produces a permanent failure
  // again, scrapeAndPersist will re-quarantine.
  await dbRun(
    db,
    `UPDATE articles SET scrape_retry_count = 0,
       next_scrape_attempt_at = NULL,
       fetch_attempt_count = 0,
       last_fetch_error = NULL,
       quarantined_at = NULL
     WHERE id = ?`,
    [articleId],
  );

  const result = await scrapeAndPersist(db, c.env, {
    id: article.id,
    canonical_url: article.canonical_url,
    preferredProvider: (feedRow?.scrape_provider as ScrapeProvider) ?? null,
  });

  if (!result.ok) {
    return c.json({
      ok: false,
      error: { code: 'scrape_failed', message: result.error ?? 'Unknown scrape error' },
    }, 502);
  }

  const updated = await dbGet<Record<string, unknown>>(
    db,
    `SELECT id, title, canonical_url, excerpt, content_text, content_html,
            word_count, extraction_method, extraction_quality,
            last_fetch_attempt_at, fetch_attempt_count, last_fetch_error,
            scrape_retry_count, next_scrape_attempt_at, quarantined_at
       FROM articles WHERE id = ?`,
    [articleId],
  );
  return c.json({ ok: true, data: updated });
});

// ---------------------------------------------------------------------------
// POST /admin/articles/:articleId/unquarantine — clear quarantine flag
//
// Lets admin un-quarantine a misclassified article without forcing a
// rescrape. Useful when the structured marker was wrong (e.g. a transient
// CDN response that triggered the PDF guard) and you want the article back
// in feeds with its current content. Resets retry counters too so the cron
// will pick it up if content is still empty.
// ---------------------------------------------------------------------------

adminRoutes.post('/admin/articles/:articleId/unquarantine', async (c) => {
  const db = c.env.DB;
  const articleId = c.req.param('articleId');

  const result = await dbRun(
    db,
    `UPDATE articles SET quarantined_at = NULL,
       scrape_retry_count = 0,
       next_scrape_attempt_at = NULL,
       last_fetch_error = NULL
     WHERE id = ? AND quarantined_at IS NOT NULL`,
    [articleId],
  );

  if (result.meta.changes === 0) {
    return c.json({ ok: false, error: { code: 'not_quarantined', message: 'Article not found or not quarantined' } }, 404);
  }

  const updated = await dbGet<Record<string, unknown>>(
    db,
    `SELECT id, title, canonical_url, scrape_retry_count, next_scrape_attempt_at,
            quarantined_at
       FROM articles WHERE id = ?`,
    [articleId],
  );
  return c.json({ ok: true, data: updated });
});

// ---------------------------------------------------------------------------
// GET /admin/articles — paginated article list for the admin UI
//
// Query params:
//   feed_id     — restrict to one feed
//   empty_only  — only articles with missing/short content
//   has_error   — only articles with last_fetch_error set
//   limit       — page size (default 50, max 200)
//   before      — cursor (epoch ms, return articles published BEFORE this)
// ---------------------------------------------------------------------------

adminRoutes.get('/admin/articles', async (c) => {
  const db = c.env.DB;

  const feedId = c.req.query('feed_id');
  const emptyOnly = c.req.query('empty_only') === 'true';
  const hasError = c.req.query('has_error') === 'true';
  // include_quarantined: false (default) hides quarantined articles. true
  // shows everything. only=true shows ONLY quarantined.
  const includeQuarantined = c.req.query('include_quarantined');
  const limitRaw = parseInt(c.req.query('limit') ?? '50', 10);
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 50, 1), 200);
  const beforeRaw = c.req.query('before');
  const before = beforeRaw ? parseInt(beforeRaw, 10) : Number.MAX_SAFE_INTEGER;

  const conditions: string[] = ['COALESCE(a.published_at, a.fetched_at) < ?'];
  const params: unknown[] = [before];

  if (feedId) {
    conditions.push('EXISTS (SELECT 1 FROM article_sources src WHERE src.article_id = a.id AND src.feed_id = ?)');
    params.push(feedId);
  }
  if (emptyOnly) {
    conditions.push('(a.content_text IS NULL OR length(a.content_text) < 50)');
  }
  if (hasError) {
    conditions.push('a.last_fetch_error IS NOT NULL');
  }
  if (includeQuarantined === 'only') {
    conditions.push('a.quarantined_at IS NOT NULL');
  } else if (includeQuarantined !== 'true') {
    conditions.push('a.quarantined_at IS NULL');
  }

  params.push(limit + 1);

  const rows = await dbAll<{
    id: string;
    title: string | null;
    canonical_url: string;
    published_at: number | null;
    fetched_at: number | null;
    content_text_length: number;
    last_fetch_error: string | null;
    scrape_retry_count: number;
    next_scrape_attempt_at: number | null;
    fetch_attempt_count: number;
    quarantined_at: number | null;
    feed_id: string | null;
    feed_title: string | null;
  }>(
    db,
    `SELECT a.id, a.title, a.canonical_url, a.published_at, a.fetched_at,
            COALESCE(length(a.content_text), 0) AS content_text_length,
            a.last_fetch_error, a.scrape_retry_count, a.next_scrape_attempt_at,
            a.fetch_attempt_count, a.quarantined_at,
            (SELECT src.feed_id FROM article_sources src WHERE src.article_id = a.id LIMIT 1) AS feed_id,
            (SELECT f.title FROM article_sources src JOIN feeds f ON f.id = src.feed_id WHERE src.article_id = a.id LIMIT 1) AS feed_title
       FROM articles a
      WHERE ${conditions.join(' AND ')}
      ORDER BY COALESCE(a.published_at, a.fetched_at) DESC
      LIMIT ?`,
    params,
  );

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextBefore = hasMore
    ? (page[page.length - 1].published_at ?? page[page.length - 1].fetched_at ?? null)
    : null;

  return c.json({
    ok: true,
    data: { articles: page, next_before: nextBefore },
  });
});

// ---------------------------------------------------------------------------
// GET /admin/briefs — paginated recent brief editions across all users
//
// Query params:
//   user_id — restrict to one user
//   limit   — page size (default 50, max 200)
//   before  — cursor (epoch ms; return briefs generated BEFORE this)
// ---------------------------------------------------------------------------

adminRoutes.get('/admin/briefs', async (c) => {
  const db = c.env.DB;

  const targetUserId = c.req.query('user_id');
  const limitRaw = parseInt(c.req.query('limit') ?? '50', 10);
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 50, 1), 200);
  const beforeRaw = c.req.query('before');
  const before = beforeRaw ? parseInt(beforeRaw, 10) : Number.MAX_SAFE_INTEGER;

  const conditions: string[] = ['b.generated_at IS NOT NULL', 'b.generated_at < ?'];
  const params: unknown[] = [before];
  if (targetUserId) {
    conditions.push('b.user_id = ?');
    params.push(targetUserId);
  }
  params.push(limit + 1);

  const rows = await dbAll<{
    id: string;
    user_id: string;
    user_email: string | null;
    edition_kind: string;
    edition_slot: string;
    timezone: string;
    status: string;
    generated_at: number;
    candidate_count: number;
    provider: string | null;
    model: string | null;
    source_count: number;
  }>(
    db,
    `SELECT b.id, b.user_id, u.email AS user_email, b.edition_kind, b.edition_slot,
            b.timezone, b.status, b.generated_at, b.candidate_count,
            b.provider, b.model,
            json_array_length(COALESCE(b.source_article_ids_json, '[]')) AS source_count
       FROM news_brief_editions b
       LEFT JOIN user u ON u.id = b.user_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY b.generated_at DESC
      LIMIT ?`,
    params,
  );

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextBefore = hasMore ? page[page.length - 1].generated_at : null;
  return c.json({ ok: true, data: { briefs: page, next_before: nextBefore } });
});

// ---------------------------------------------------------------------------
// POST /admin/briefs/generate-for-user — trigger brief generation on-demand
//
// Body: { user_id, edition_kind: 'morning' | 'evening', edition_slot? }
//
// Bypasses the timezone-based cron check so an admin can force-fire a brief
// for diagnostics. Re-uses persistBrief() so the row shape matches /today.
// ---------------------------------------------------------------------------

adminRoutes.post('/admin/briefs/generate-for-user', async (c) => {
  const db = c.env.DB;
  const body = await c.req.json<{
    user_id: string;
    edition_kind: 'morning' | 'evening' | 'ondemand';
    edition_slot?: string;
    lookback_hours?: number;
    suppressed_topics?: Array<{ signature: string; expires_at: number; allow_resurface_on_developments: boolean }>;
  }>();

  if (!body.user_id) {
    return c.json({ ok: false, error: { code: 'bad_request', message: 'user_id is required' } }, 400);
  }
  const editionKind = body.edition_kind === 'evening' || body.edition_kind === 'ondemand' ? body.edition_kind : 'morning';
  const lookbackHours = body.lookback_hours ?? 12;

  const ai = await resolveAIKey(db, body.user_id, c.req.raw, c.env);
  if (!ai) {
    return c.json({ ok: false, error: { code: 'no_ai_key', message: 'No AI provider configured for user' } }, 503);
  }

  // Gather scored articles from that user's subscribed feeds within lookback.
  const cutoffSetting = await dbGet<{ value: string }>(
    db,
    `SELECT value FROM settings WHERE user_id = ? AND key = 'newsBriefScoreCutoff'`,
    [body.user_id],
  );
  const tzRow = await dbGet<{ value: string }>(
    db,
    `SELECT value FROM settings WHERE user_id = ? AND key = 'newsBriefTimezone'`,
    [body.user_id],
  );
  const scoreCutoff = parseInt(cutoffSetting?.value ?? '') || 3;
  const timezone = tzRow?.value || 'UTC';
  const now = Date.now();
  const cutoffMs = now - lookbackHours * 3_600_000;

  const rows = await dbAll<{
    id: string;
    title: string | null;
    published_at: number | null;
    score: number;
    feed_title: string | null;
    summary_text: string | null;
    image_url: string | null;
  }>(
    db,
    `SELECT a.id, a.title, a.published_at, a.image_url,
            MAX(COALESCE(s.score, 0)) AS score,
            (SELECT f.title FROM feeds f
               JOIN article_sources src2 ON src2.feed_id = f.id
              WHERE src2.article_id = a.id LIMIT 1) AS feed_title,
            (SELECT summary_text FROM article_summaries
              WHERE article_id = a.id ORDER BY created_at DESC LIMIT 1) AS summary_text
       FROM article_sources src
       JOIN user_feed_subscriptions ufs ON ufs.feed_id = src.feed_id AND ufs.user_id = ? AND ufs.paused = 0
       JOIN articles a ON a.id = src.article_id
  LEFT JOIN article_scores s ON s.article_id = src.article_id AND s.user_id = ?
      WHERE src.created_at >= ?
        AND COALESCE(s.score, 0) >= ?
        AND a.quarantined_at IS NULL
        AND a.content_text IS NOT NULL AND a.word_count >= 100
      GROUP BY a.id
      ORDER BY score DESC, a.word_count DESC, COALESCE(a.published_at, a.fetched_at) DESC
      LIMIT 20`,
    [body.user_id, body.user_id, cutoffMs, scoreCutoff],
  );

  if (rows.length === 0) {
    return c.json({ ok: false, error: { code: 'no_candidates', message: 'No scored articles in lookback window' } }, 409);
  }

  const candidates = rows.map((r) => ({
    id: r.id,
    title: r.title ?? 'Untitled',
    sourceName: r.feed_title ?? null,
    publishedAt: r.published_at,
    effectiveScore: r.score,
    context: r.summary_text ?? '',
    imageUrl: r.image_url ?? null,
  }));

  const windowLabel = editionKind === 'morning' ? 'Morning Brief' : editionKind === 'evening' ? 'Evening Brief' : 'News Brief';
  const nowForFilter = Date.now();
  const activeSuppressions = (body.suppressed_topics ?? []).filter((t) => t.expires_at > nowForFilter);
  const messages = buildNewsBriefPrompt(candidates, windowLabel, 5, undefined, activeSuppressions);
  const { content } = await runChat(ai.provider, ai.apiKey, ai.model, messages);
  const parsed = parseJsonResponse(content) as Record<string, unknown> | null;
  const rawBullets = Array.isArray(parsed?.bullets)
    ? (parsed!.bullets as Array<{ text?: string; source_article_ids?: string[] }>)
    : [];

  const candidateMap = new Map(candidates.map((c) => [c.id, c]));
  const bullets = rawBullets.map((b) => {
    const sources = (b.source_article_ids ?? [])
      .map((id) => candidateMap.get(id))
      .filter(Boolean)
      .map((a) => ({ article_id: a!.id, title: a!.title, canonical_url: null }));
    return { text: b.text ?? '', sources };
  });

  const slot = body.edition_slot ?? `${editionKind}-admin-${now}`;
  const inserted = await persistBrief(db, {
    userId: body.user_id,
    editionKind,
    editionSlot: slot,
    timezone,
    windowStart: cutoffMs,
    windowEnd: now,
    scoreCutoff,
    bullets,
    sourceArticleIds: candidates.map((c) => c.id),
    provider: ai.provider,
    model: ai.model,
    candidateCount: candidates.length,
    now,
  });

  // Optional push side effect — useful for verifying the iOS Notification
  // Service Extension end-to-end without waiting for the timezone cron.
  // Off by default so admins poking around for diagnostics don't spam the
  // user. Same payload shape as scheduled-briefs.ts.
  let pushed = false;
  if (c.req.query('push') === 'true' && inserted.id) {
    const firstBullet = bullets[0]?.text ?? '';
    const trimmedBody = firstBullet.length > 140 ? firstBullet.slice(0, 137) + '…' : firstBullet;
    const trimmedBullets = bullets
      .slice(0, 3)
      .map((b) => {
        const text = b.text ?? '';
        return text.length > 80 ? text.slice(0, 77) + '…' : text;
      })
      .filter((s) => s.length > 0);
    const leadImage = candidates.find((c) => c.imageUrl)?.imageUrl ?? null;
    await sendPushToUser(db, c.env, body.user_id, {
      title: editionKind === 'morning' ? 'Morning Brief' : editionKind === 'evening' ? 'Evening Brief' : 'News Brief',
      body: trimmedBody || 'Your news brief is ready.',
      data: {
        type: 'brief',
        edition: editionKind,
        id: inserted.id,
        bullets: trimmedBullets,
        image_url: leadImage,
      },
    });
    pushed = true;
  }

  return c.json({
    ok: true,
    data: {
      id: inserted.id,
      user_id: body.user_id,
      edition_kind: editionKind,
      edition_slot: slot,
      candidate_count: candidates.length,
      bullet_count: bullets.length,
      generated_at: now,
      duplicate: inserted.id === null,
      pushed,
    },
  });
});

// ---------------------------------------------------------------------------
// GET /admin/ai-stats — AI usage overview
// ---------------------------------------------------------------------------

adminRoutes.get('/admin/ai-stats', async (c) => {
  const db = c.env.DB;
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

  const [daily, weekly, byProvider, byEndpoint, errors] = await Promise.all([
    dbGet<{ total_tokens: number; call_count: number }>(
      db,
      `SELECT COALESCE(SUM(tokens_input + tokens_output), 0) AS total_tokens, COUNT(*) AS call_count FROM ai_usage WHERE created_at >= ?`,
      [dayAgo],
    ),
    dbGet<{ total_tokens: number; call_count: number }>(
      db,
      `SELECT COALESCE(SUM(tokens_input + tokens_output), 0) AS total_tokens, COUNT(*) AS call_count FROM ai_usage WHERE created_at >= ?`,
      [weekAgo],
    ),
    dbAll<{ provider: string; total_tokens: number; call_count: number }>(
      db,
      `SELECT provider, COALESCE(SUM(tokens_input + tokens_output), 0) AS total_tokens, COUNT(*) AS call_count FROM ai_usage WHERE created_at >= ? GROUP BY provider`,
      [weekAgo],
    ),
    dbAll<{ endpoint: string; call_count: number }>(
      db,
      `SELECT endpoint, COUNT(*) AS call_count FROM ai_usage WHERE created_at >= ? AND endpoint IS NOT NULL GROUP BY endpoint ORDER BY call_count DESC`,
      [weekAgo],
    ),
    dbGet<{ cnt: number }>(
      db,
      `SELECT COUNT(*) AS cnt FROM ai_usage WHERE created_at >= ? AND (tokens_output = 0 OR tokens_input = 0)`,
      [weekAgo],
    ),
  ]);

  return c.json({
    ok: true,
    data: {
      daily: { tokens: daily?.total_tokens ?? 0, calls: daily?.call_count ?? 0 },
      weekly: { tokens: weekly?.total_tokens ?? 0, calls: weekly?.call_count ?? 0 },
      by_provider: byProvider,
      by_endpoint: byEndpoint,
      possible_errors_7d: errors?.cnt ?? 0,
    },
  });
});

// ---------------------------------------------------------------------------
// GET /admin/health — system health overview
// ---------------------------------------------------------------------------

adminRoutes.get('/admin/health', async (c) => {
  const db = c.env.DB;
  const now = Date.now();
  const hourAgo = now - 60 * 60 * 1000;

  const [recentPulls, feedErrors, userCount, articleCount, scoredCount] = await Promise.all([
    dbAll<{ id: string; status: string; stats_json: string; completed_at: number }>(
      db,
      `SELECT id, status, stats_json, completed_at FROM pull_runs ORDER BY completed_at DESC LIMIT 5`,
    ),
    dbGet<{ cnt: number }>(db, `SELECT COUNT(*) AS cnt FROM feeds WHERE error_count > 3`),
    dbGet<{ cnt: number }>(db, `SELECT COUNT(*) AS cnt FROM user`),
    dbGet<{ cnt: number }>(db, `SELECT COUNT(*) AS cnt FROM articles`),
    dbGet<{ cnt: number }>(db, `SELECT COUNT(*) AS cnt FROM article_scores WHERE created_at >= ?`, [hourAgo]),
  ]);

  return c.json({
    ok: true,
    data: {
      recent_pulls: recentPulls.map(p => ({
        ...p,
        stats: p.stats_json ? JSON.parse(p.stats_json) : null,
      })),
      feeds_with_errors: feedErrors?.cnt ?? 0,
      total_users: userCount?.cnt ?? 0,
      total_articles: articleCount?.cnt ?? 0,
      articles_scored_last_hour: scoredCount?.cnt ?? 0,
    },
  });
});

// ---------------------------------------------------------------------------
// GET /admin/scraping-stats — deep-fetch usage and error overview
// ---------------------------------------------------------------------------

adminRoutes.get('/admin/scraping-stats', async (c) => {
  const db = c.env.DB;
  const now = Date.now();
  const hourAgo = now - 60 * 60 * 1000;
  const dayAgo = now - 24 * 60 * 60 * 1000;

  const [fetched1h, fetched24h, onCooldown, withErrors, avgQuality, byMode, recentErrors] = await Promise.all([
    dbGet<{ cnt: number }>(
      db,
      `SELECT COUNT(*) AS cnt FROM articles WHERE last_fetch_attempt_at >= ? AND fetch_attempt_count > 0`,
      [hourAgo],
    ),
    dbGet<{ cnt: number }>(
      db,
      `SELECT COUNT(*) AS cnt FROM articles WHERE last_fetch_attempt_at >= ? AND fetch_attempt_count > 0`,
      [dayAgo],
    ),
    dbGet<{ cnt: number }>(
      db,
      `SELECT COUNT(*) AS cnt FROM articles WHERE fetch_attempt_count > 1 AND last_fetch_attempt_at >= ?`,
      [hourAgo],
    ),
    dbGet<{ cnt: number }>(
      db,
      `SELECT COUNT(*) AS cnt FROM articles WHERE last_fetch_error IS NOT NULL`,
    ),
    dbGet<{ avg_quality: number | null }>(
      db,
      `SELECT AVG(extraction_quality) AS avg_quality FROM articles WHERE fetch_attempt_count > 0 AND extraction_quality IS NOT NULL AND last_fetch_attempt_at >= ?`,
      [dayAgo],
    ),
    dbAll<{ scrape_mode: string; fetch_count: number }>(
      db,
      `SELECT f.scrape_mode, COUNT(DISTINCT a.id) AS fetch_count
       FROM articles a
       JOIN article_sources ars ON ars.article_id = a.id
       JOIN feeds f ON f.id = ars.feed_id
       WHERE a.fetch_attempt_count > 0 AND a.last_fetch_attempt_at >= ?
       GROUP BY f.scrape_mode`,
      [dayAgo],
    ),
    dbAll<{ article_id: string; title: string | null; error: string; attempted_at: number; feed_title: string | null }>(
      db,
      `SELECT a.id AS article_id, a.title, a.last_fetch_error AS error, a.last_fetch_attempt_at AS attempted_at,
              (SELECT f.title FROM article_sources ars JOIN feeds f ON f.id = ars.feed_id WHERE ars.article_id = a.id LIMIT 1) AS feed_title
       FROM articles a
       WHERE a.last_fetch_error IS NOT NULL
       ORDER BY a.last_fetch_attempt_at DESC
       LIMIT 20`,
    ),
  ]);

  return c.json({
    ok: true,
    data: {
      fetched_1h: fetched1h?.cnt ?? 0,
      fetched_24h: fetched24h?.cnt ?? 0,
      on_cooldown: onCooldown?.cnt ?? 0,
      total_with_errors: withErrors?.cnt ?? 0,
      avg_extraction_quality_24h: avgQuality?.avg_quality ?? null,
      by_scrape_mode: byMode,
      recent_errors: recentErrors,
    },
  });
});

// ---------------------------------------------------------------------------
// GET /admin/tool-call-stats — M11 tool-calling usage overview
// ---------------------------------------------------------------------------

adminRoutes.get('/admin/tool-call-stats', async (c) => {
  const db = c.env.DB;
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  type Row = { tool_calls_json: string; created_at: number };
  const rows = await dbAll<Row>(
    db,
    `SELECT tool_calls_json, created_at
     FROM chat_messages
     WHERE tool_calls_json IS NOT NULL AND created_at >= ?
     ORDER BY created_at DESC
     LIMIT 1000`,
    [weekAgo],
  );

  type Call = { kind: string; name: string; succeeded?: boolean };
  type Agg = { count: number; succeeded: number; failed: number; lastAt: number };
  const byTool = new Map<string, Agg>();
  let totalCalls = 0;
  let serverCalls = 0;
  let clientCalls = 0;

  for (const row of rows) {
    let calls: Call[] = [];
    try { calls = JSON.parse(row.tool_calls_json) as Call[]; } catch { continue; }
    for (const call of calls) {
      totalCalls++;
      if (call.kind === 'server') serverCalls++;
      else if (call.kind === 'client') clientCalls++;

      const agg = byTool.get(call.name) ?? { count: 0, succeeded: 0, failed: 0, lastAt: 0 };
      agg.count++;
      if (call.succeeded === true) agg.succeeded++;
      else if (call.succeeded === false) agg.failed++;
      agg.lastAt = Math.max(agg.lastAt, row.created_at);
      byTool.set(call.name, agg);
    }
  }

  // Pull thrown-error counts from debug_log (scope tool-error:{name}) so we can
  // surface tool failures that crashed before they could record succeeded=false.
  type ErrRow = { scope: string; n: number };
  const errRows = await dbAll<ErrRow>(
    db,
    `SELECT scope, COUNT(*) AS n
       FROM debug_log
       WHERE scope LIKE 'tool-error:%' AND created_at >= ?
       GROUP BY scope`,
    [weekAgo],
  );
  const errByTool = new Map<string, number>();
  for (const r of errRows) {
    errByTool.set(r.scope.replace(/^tool-error:/, ''), r.n);
  }

  const byToolSorted = [...byTool.entries()]
    .map(([name, agg]) => {
      const thrown = errByTool.get(name) ?? 0;
      const loggingGap = Math.max(0, agg.count - agg.succeeded - agg.failed);
      return {
        name,
        count: agg.count,
        succeeded: agg.succeeded,
        failed: agg.failed,
        thrown_errors: thrown,
        logging_gap: loggingGap,
        success_rate: agg.count > 0 ? agg.succeeded / agg.count : null,
        last_at: agg.lastAt,
      };
    })
    .sort((a, b) => b.count - a.count);

  return c.json({
    ok: true,
    data: {
      window_days: 7,
      total_calls: totalCalls,
      server_calls: serverCalls,
      client_calls: clientCalls,
      messages_with_tools: rows.length,
      by_tool: byToolSorted,
    },
  });
});

// ---------------------------------------------------------------------------
// GET /admin/me — return identity for the signed-in admin
//
// The is_admin middleware has already gated this route, so reaching here
// implies is_admin = true. We additionally return user_id + email so the
// web admin can render "Signed in as <email>" without a second round-trip.
// ---------------------------------------------------------------------------

adminRoutes.get('/admin/me', async (c) => {
  const userId = c.get('userId');
  const row = await dbGet<{ id: string; email: string | null; name: string | null }>(
    c.env.DB,
    `SELECT id, email, name FROM user WHERE id = ?`,
    [userId],
  );
  return c.json({
    ok: true,
    data: {
      is_admin: true,
      user_id: row?.id ?? userId,
      email: row?.email ?? null,
      name: row?.name ?? null,
    },
  });
});

// ---------------------------------------------------------------------------
// GET /admin/usage — Steel + Browserless cost observability
//
// Query params:
//   days  — how many days of rollup history to return (default 30, max 90)
//
// Response shape:
//   {
//     today: { steel: {...}, browserless: {...} },
//     daily: [ { provider, day_unix, call_count, success_count, error_count,
//                p50_duration_ms, p95_duration_ms } ]
//   }
//
// "Today" is computed live from provider_calls because the daily rollup cron
// only runs at 3:30am UTC. Historical days come from provider_usage_daily.
// ---------------------------------------------------------------------------

adminRoutes.get('/admin/usage', async (c) => {
  const db = c.env.DB;
  const daysRaw = parseInt(c.req.query('days') ?? '30', 10);
  const days = Math.min(Math.max(Number.isFinite(daysRaw) ? daysRaw : 30, 1), 90);
  const now = Date.now();
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  const todayStart = Math.floor(now / (24 * 60 * 60 * 1000)) * (24 * 60 * 60 * 1000);

  const [daily, todayRows] = await Promise.all([
    dbAll<{
      provider: string;
      day_unix: number;
      call_count: number;
      success_count: number;
      error_count: number;
      total_duration_ms: number;
      p50_duration_ms: number | null;
      p95_duration_ms: number | null;
    }>(
      db,
      `SELECT provider, day_unix, call_count, success_count, error_count,
              total_duration_ms, p50_duration_ms, p95_duration_ms
         FROM provider_usage_daily
        WHERE day_unix >= ?
        ORDER BY day_unix DESC, provider ASC`,
      [cutoff],
    ),
    dbAll<{ provider: string; success: number; duration_ms: number }>(
      db,
      `SELECT provider, success, duration_ms FROM provider_calls WHERE started_at >= ?`,
      [todayStart],
    ),
  ]);

  // Compute today's running totals on the fly. Same shape as the rollup row
  // so the client can render uniformly; computed_at is omitted.
  const todayBuckets = new Map<string, { call_count: number; success_count: number; error_count: number; durations: number[] }>();
  for (const r of todayRows) {
    let b = todayBuckets.get(r.provider);
    if (!b) { b = { call_count: 0, success_count: 0, error_count: 0, durations: [] }; todayBuckets.set(r.provider, b); }
    b.call_count++;
    b.durations.push(r.duration_ms);
    if (r.success === 1) b.success_count++;
    else b.error_count++;
  }
  const today: Record<string, unknown> = {};
  for (const [provider, b] of todayBuckets.entries()) {
    const sorted = b.durations.slice().sort((a, z) => a - z);
    const p50Idx = Math.min(sorted.length - 1, Math.floor(0.5 * sorted.length));
    const p95Idx = Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length));
    today[provider] = {
      day_unix: todayStart,
      call_count: b.call_count,
      success_count: b.success_count,
      error_count: b.error_count,
      total_duration_ms: sorted.reduce((a, z) => a + z, 0),
      p50_duration_ms: sorted[p50Idx] ?? null,
      p95_duration_ms: sorted[p95Idx] ?? null,
    };
  }

  return c.json({ ok: true, data: { today, daily } });
});
