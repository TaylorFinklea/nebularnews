import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { dbGet, dbAll } from '../db/helpers';

export const todayRoutes = new Hono<AppEnv>();

const esc = (uid: string) => uid.replace(/'/g, "''");

todayRoutes.get('/today', async (c) => {
  const db = c.env.DB;
  const userId = c.get('userId');
  const now = Date.now();
  const oneDayAgo = now - 86_400_000;

  // Unread count, new-today count, high-fit unread count
  const [unreadRow, newTodayRow, highFitRow] = await Promise.all([
    dbGet<{ count: number }>(db,
      `SELECT COUNT(*) as count FROM articles a
       WHERE EXISTS (SELECT 1 FROM article_sources src JOIN user_feed_subscriptions ufs ON ufs.feed_id = src.feed_id WHERE src.article_id = a.id AND ufs.user_id = ?)
       AND NOT EXISTS (SELECT 1 FROM article_read_state rs WHERE rs.article_id = a.id AND rs.user_id = ? AND rs.is_read = 1)`,
      [userId, userId]),
    dbGet<{ count: number }>(db,
      `SELECT COUNT(*) as count FROM articles a
       WHERE COALESCE(a.fetched_at, 0) >= ?
       AND EXISTS (SELECT 1 FROM article_sources src JOIN user_feed_subscriptions ufs ON ufs.feed_id = src.feed_id WHERE src.article_id = a.id AND ufs.user_id = ?)`,
      [oneDayAgo, userId]),
    dbGet<{ count: number }>(db,
      `SELECT COUNT(*) as count FROM articles a
       WHERE EXISTS (SELECT 1 FROM article_scores s WHERE s.article_id = a.id AND s.user_id = ? AND s.score >= 4)
       AND NOT EXISTS (SELECT 1 FROM article_read_state rs WHERE rs.article_id = a.id AND rs.user_id = ? AND rs.is_read = 1)`,
      [userId, userId]),
  ]);

  // Up-next articles (unread, score >= 3, limit 6)
  const upNext = await dbAll<Record<string, unknown>>(db,
    `SELECT a.id, a.canonical_url, a.title, a.author, a.published_at, a.fetched_at,
       a.excerpt, a.word_count, a.image_url,
       0 as is_read,
       (SELECT s.score FROM article_scores s WHERE s.article_id = a.id AND s.user_id = '${esc(userId)}' ORDER BY s.created_at DESC LIMIT 1) as score,
       (SELECT s.label FROM article_scores s WHERE s.article_id = a.id AND s.user_id = '${esc(userId)}' ORDER BY s.created_at DESC LIMIT 1) as score_label,
       (SELECT s.scoring_method FROM article_scores s WHERE s.article_id = a.id AND s.user_id = '${esc(userId)}' ORDER BY s.created_at DESC LIMIT 1) as scoring_method,
       (SELECT summary_text FROM article_summaries WHERE article_id = a.id ORDER BY created_at DESC LIMIT 1) as summary_text,
       (SELECT f.title FROM article_sources src JOIN feeds f ON f.id = src.feed_id WHERE src.article_id = a.id LIMIT 1) as source_name,
       (SELECT src.feed_id FROM article_sources src WHERE src.article_id = a.id LIMIT 1) as source_feed_id
     FROM articles a
     WHERE EXISTS (SELECT 1 FROM article_sources src JOIN user_feed_subscriptions ufs ON ufs.feed_id = src.feed_id WHERE src.article_id = a.id AND ufs.user_id = '${esc(userId)}')
     AND NOT EXISTS (SELECT 1 FROM article_read_state rs WHERE rs.article_id = a.id AND rs.user_id = '${esc(userId)}' AND rs.is_read = 1)
     AND EXISTS (SELECT 1 FROM article_scores s WHERE s.article_id = a.id AND s.user_id = '${esc(userId)}' AND s.score >= 3)
     ORDER BY (SELECT s.score FROM article_scores s WHERE s.article_id = a.id AND s.user_id = '${esc(userId)}' ORDER BY s.created_at DESC LIMIT 1) DESC,
       COALESCE(a.published_at, a.fetched_at) DESC
     LIMIT 6`,
    []);

  // Hero = first up-next article (or null)
  const hero = upNext.length > 0 ? upNext[0] : null;
  const upNextRest = upNext.slice(1);

  // Latest news brief
  const briefRow = await dbGet<{ id: string; bullets_json: string; generated_at: number; edition_kind: string; edition_slot: string; window_start: number; window_end: number; score_cutoff: number }>(db,
    `SELECT id, bullets_json, generated_at, edition_kind, edition_slot, window_start, window_end, score_cutoff
     FROM news_brief_editions WHERE user_id = ? AND status = 'done' ORDER BY generated_at DESC LIMIT 1`,
    [userId]);

  let newsBrief = null;
  if (briefRow) {
    const windowHours = Math.round((briefRow.window_end - briefRow.window_start) / 3_600_000);
    newsBrief = {
      state: 'done',
      title: `${briefRow.edition_kind === 'morning' ? 'Morning' : 'Evening'} Brief`,
      edition_label: briefRow.edition_slot,
      generated_at: briefRow.generated_at,
      window_hours: windowHours,
      score_cutoff: briefRow.score_cutoff,
      bullets: JSON.parse(briefRow.bullets_json || '[]'),
      next_scheduled_at: null,
      stale: false,
    };
  }

  return c.json({
    ok: true,
    data: {
      hero,
      up_next: upNextRest,
      stats: {
        unread_total: unreadRow?.count ?? 0,
        new_today: newTodayRow?.count ?? 0,
        high_fit_unread: highFitRow?.count ?? 0,
      },
      news_brief: newsBrief,
    },
  });
});
