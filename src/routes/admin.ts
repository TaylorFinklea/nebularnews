import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import type { AppEnv } from '../index';
import { dbGet, dbAll, dbRun } from '../db/helpers';
import { scrapeAndPersist, type ScrapeProvider } from '../lib/scraper';
import { generateOpenAIImage, generateImagen3 } from '../lib/image-gen';

const ALLOWED_SCRAPE_MODES = new Set(['rss_only', 'auto_fetch_on_empty', 'always']);

// ---------------------------------------------------------------------------
// Fallback image helpers (R2 pool used as default article images)
// ---------------------------------------------------------------------------

const FALLBACK_SLOT_COUNT = 30;
const FALLBACK_PUBLIC_BASE = 'https://r2-fallback.nebularnews.com';

function slotToKey(slot: number): string {
  return `fallback-${String(slot).padStart(3, '0')}.jpg`;
}

function parseSlot(raw: string): number | null {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1 || n > FALLBACK_SLOT_COUNT) return null;
  return n;
}

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
// ---------------------------------------------------------------------------

adminRoutes.use('*', async (c, next) => {
  if (!AUDITED_METHODS.has(c.req.method)) {
    await next();
    return;
  }

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
        console.error('[admin-audit] failed to write row:', err);
      }
    })(),
  );
});

// ---------------------------------------------------------------------------
// Fallback images
// ---------------------------------------------------------------------------

adminRoutes.get('/admin/fallback-images', async (c) => {
  const r2 = c.env.R2_FALLBACK;
  const slots = await Promise.all(
    Array.from({ length: FALLBACK_SLOT_COUNT }, async (_, i) => {
      const slot = i + 1;
      const key = slotToKey(slot);
      const obj = await r2.head(key);
      if (!obj) return { slot, exists: false };
      const meta = obj.customMetadata ?? {};
      return {
        slot,
        exists: true,
        lastPrompt: meta.prompt ?? undefined,
        lastProvider: (meta.provider as 'openai' | 'imagen3' | undefined) ?? undefined,
        lastGeneratedAt: meta.generatedAt ? parseInt(meta.generatedAt, 10) : undefined,
      };
    }),
  );
  return c.json({ ok: true, data: { slots } });
});

adminRoutes.post('/admin/fallback-images/:slot/generate', async (c) => {
  const slot = parseSlot(c.req.param('slot'));
  if (slot === null) {
    return c.json({ ok: false, error: { code: 'bad_request', message: 'slot must be an integer 1–30' } }, 400);
  }

  const body = await c.req.json<{ provider: 'openai' | 'imagen3'; prompt: string }>();
  if (!body.provider || !['openai', 'imagen3'].includes(body.provider)) {
    return c.json({ ok: false, error: { code: 'bad_request', message: 'provider must be openai or imagen3' } }, 400);
  }
  if (!body.prompt || typeof body.prompt !== 'string') {
    return c.json({ ok: false, error: { code: 'bad_request', message: 'prompt is required' } }, 400);
  }
  if (body.prompt.length > 2000) {
    return c.json({ ok: false, error: { code: 'bad_request', message: 'prompt must be 2000 characters or fewer' } }, 400);
  }

  let imageBytes: Uint8Array;
  let mimeType: string;
  try {
    if (body.provider === 'openai') {
      const apiKey = c.env.OPENAI_API_KEY;
      if (!apiKey) return c.json({ ok: false, error: { code: 'not_configured', message: 'OPENAI_API_KEY is not set' } }, 503);
      const result = await generateOpenAIImage(body.prompt, apiKey);
      imageBytes = result.bytes;
      mimeType = result.mimeType;
    } else {
      const apiKey = c.env.GEMINI_API_KEY;
      if (!apiKey) return c.json({ ok: false, error: { code: 'not_configured', message: 'GEMINI_API_KEY is not set' } }, 503);
      const result = await generateImagen3(body.prompt, apiKey);
      imageBytes = result.bytes;
      mimeType = result.mimeType;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Image generation failed';
    return c.json({ ok: false, error: { code: 'generation_failed', message } }, 502);
  }

  const previewId = nanoid();
  const previewKey = `previews/${previewId}`;
  await c.env.R2_FALLBACK.put(previewKey, imageBytes, {
    httpMetadata: { contentType: mimeType },
    customMetadata: {
      slot: String(slot),
      prompt: body.prompt,
      provider: body.provider,
      generatedAt: String(Date.now()),
    },
  });

  const previewUrl = `${FALLBACK_PUBLIC_BASE}/${previewKey}`;
  return c.json({ ok: true, data: { previewId, previewUrl } });
});

adminRoutes.post('/admin/fallback-images/:slot/commit', async (c) => {
  const slot = parseSlot(c.req.param('slot'));
  if (slot === null) {
    return c.json({ ok: false, error: { code: 'bad_request', message: 'slot must be an integer 1–30' } }, 400);
  }

  const body = await c.req.json<{ previewId: string }>();
  if (!body.previewId || typeof body.previewId !== 'string') {
    return c.json({ ok: false, error: { code: 'bad_request', message: 'previewId is required' } }, 400);
  }

  const previewKey = `previews/${body.previewId}`;
  const preview = await c.env.R2_FALLBACK.get(previewKey);
  if (!preview) {
    return c.json({ ok: false, error: { code: 'not_found', message: 'Preview not found — it may have expired' } }, 404);
  }

  const previewMeta = preview.customMetadata ?? {};
  const destKey = slotToKey(slot);

  const bytes = await preview.arrayBuffer();
  await c.env.R2_FALLBACK.put(destKey, bytes, {
    httpMetadata: { contentType: preview.httpMetadata?.contentType ?? 'image/jpeg' },
    customMetadata: {
      prompt: previewMeta.prompt ?? '',
      provider: previewMeta.provider ?? '',
      generatedAt: previewMeta.generatedAt ?? String(Date.now()),
    },
  });

  await c.env.R2_FALLBACK.delete(previewKey);

  const url = `${FALLBACK_PUBLIC_BASE}/${destKey}`;
  return c.json({ ok: true, data: { slot, url } });
});

adminRoutes.delete('/admin/fallback-images/preview/:previewId', async (c) => {
  const previewId = c.req.param('previewId');
  await c.env.R2_FALLBACK.delete(`previews/${previewId}`);
  return c.json({ ok: true, data: {} });
});

// ---------------------------------------------------------------------------
// Audit log
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
// Users
// ---------------------------------------------------------------------------

adminRoutes.get('/admin/users', async (c) => {
  const db = c.env.DB;

  const users = await dbAll<{
    id: string; name: string | null; email: string | null;
    is_admin: number; created_at: string;
  }>(db, `SELECT id, name, email, is_admin, createdAt as created_at FROM user ORDER BY createdAt DESC LIMIT 100`);

  const enriched = [];
  for (const u of users) {
    const [feedCount, articleStates] = await Promise.all([
      dbGet<{ cnt: number }>(db, `SELECT COUNT(*) AS cnt FROM user_feed_subscriptions WHERE user_id = ?`, [u.id]),
      dbGet<{ read_count: number; last_active: number | null }>(
        db,
        `SELECT COUNT(CASE WHEN is_read = 1 THEN 1 END) AS read_count,
                MAX(updated_at) AS last_active
           FROM article_read_state WHERE user_id = ?`,
        [u.id],
      ),
    ]);

    enriched.push({
      id: u.id,
      name: u.name,
      email: u.email,
      is_admin: u.is_admin === 1,
      created_at: u.created_at,
      feed_count: feedCount?.cnt ?? 0,
      articles_read: articleStates?.read_count ?? 0,
      last_active: articleStates?.last_active ?? null,
    });
  }

  return c.json({ ok: true, data: enriched });
});

adminRoutes.post('/admin/users/:userId/role', async (c) => {
  const db = c.env.DB;
  const targetUserId = c.req.param('userId');
  const body = await c.req.json<{ is_admin: boolean }>();

  await dbRun(db, `UPDATE user SET is_admin = ? WHERE id = ?`, [body.is_admin ? 1 : 0, targetUserId]);
  return c.json({ ok: true, data: { userId: targetUserId, is_admin: body.is_admin } });
});

// ---------------------------------------------------------------------------
// Feeds
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

adminRoutes.post('/admin/feeds/:feedId/repoll', async (c) => {
  const db = c.env.DB;
  const feedId = c.req.param('feedId');
  await dbRun(db, `UPDATE feeds SET next_poll_at = 0, error_count = 0 WHERE id = ?`, [feedId]);
  return c.json({ ok: true, data: { feedId, message: 'Feed queued for next poll' } });
});

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
// Articles
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

  const feedRow = await dbGet<{ scrape_provider: string | null }>(
    db,
    `SELECT f.scrape_provider FROM article_sources src
       JOIN feeds f ON f.id = src.feed_id
      WHERE src.article_id = ? AND f.scrape_provider IS NOT NULL
      LIMIT 1`,
    [articleId],
  );

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

adminRoutes.get('/admin/articles', async (c) => {
  const db = c.env.DB;

  const feedId = c.req.query('feed_id');
  const emptyOnly = c.req.query('empty_only') === 'true';
  const hasError = c.req.query('has_error') === 'true';
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
// Health + scraping stats
// ---------------------------------------------------------------------------

adminRoutes.get('/admin/health', async (c) => {
  const db = c.env.DB;

  const [recentPulls, feedErrors, userCount, articleCount] = await Promise.all([
    dbAll<{ id: string; status: string; stats_json: string; completed_at: number }>(
      db,
      `SELECT id, status, stats_json, completed_at FROM pull_runs ORDER BY completed_at DESC LIMIT 5`,
    ),
    dbGet<{ cnt: number }>(db, `SELECT COUNT(*) AS cnt FROM feeds WHERE error_count > 3`),
    dbGet<{ cnt: number }>(db, `SELECT COUNT(*) AS cnt FROM user`),
    dbGet<{ cnt: number }>(db, `SELECT COUNT(*) AS cnt FROM articles`),
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
    },
  });
});

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
// Identity
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
