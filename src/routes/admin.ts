import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { dbGet, dbAll, dbRun } from '../db/helpers';

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
      dbGet<{ read_count: number; last_active: number | null }>(db, `SELECT COUNT(CASE WHEN read_at IS NOT NULL THEN 1 END) AS read_count, MAX(COALESCE(read_at, created_at)) AS last_active FROM user_article_states WHERE user_id = ?`, [u.id]),
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
    `SELECT f.id, f.title, f.url, f.feed_type, f.error_count, f.last_polled_at,
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
// GET /admin/me — check if current user is admin
// ---------------------------------------------------------------------------

adminRoutes.get('/admin/me', async (c) => {
  return c.json({ ok: true, data: { is_admin: true } });
});
