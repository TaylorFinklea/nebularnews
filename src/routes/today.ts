import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { dbGet, dbAll } from '../db/helpers';

export const todayRoutes = new Hono<AppEnv>();

interface CountRow {
  count: number;
}

interface TopArticle {
  id: string;
  title: string;
  image_url: string | null;
  published_at: number;
  score: number;
  score_label: string | null;
}

interface LatestBrief {
  id: string;
  bullets_json: string;
  generated_at: number;
}

todayRoutes.get('/today', async (c) => {
  const db = c.env.DB;
  const userId = c.get('userId');

  const [unreadRow, topArticles, latestBrief, upNextRow] = await Promise.all([
    dbGet<CountRow>(
      db,
      `SELECT COUNT(*) as count FROM articles a
       WHERE EXISTS (
         SELECT 1 FROM article_sources src
         JOIN user_feed_subscriptions ufs ON ufs.feed_id = src.feed_id
         WHERE src.article_id = a.id AND ufs.user_id = ?
       )
       AND NOT EXISTS (
         SELECT 1 FROM article_read_state rs
         WHERE rs.article_id = a.id AND rs.user_id = ? AND rs.is_read = 1
       )`,
      [userId, userId],
    ),
    dbAll<TopArticle>(
      db,
      `SELECT a.id, a.title, a.image_url, a.published_at, s.score, s.score_label
       FROM article_scores s
       JOIN articles a ON a.id = s.article_id
       WHERE s.user_id = ? AND s.scoring_method = 'algorithmic'
       ORDER BY s.score DESC
       LIMIT 5`,
      [userId],
    ),
    dbGet<LatestBrief>(
      db,
      `SELECT id, bullets_json, generated_at FROM news_brief_editions
       WHERE user_id = ? AND status = 'done'
       ORDER BY generated_at DESC
       LIMIT 1`,
      [userId],
    ),
    dbGet<CountRow>(
      db,
      `SELECT COUNT(*) as count FROM articles a
       JOIN article_scores s ON s.article_id = a.id AND s.user_id = ? AND s.scoring_method = 'algorithmic'
       WHERE s.score >= 3
       AND NOT EXISTS (
         SELECT 1 FROM article_read_state rs
         WHERE rs.article_id = a.id AND rs.user_id = ? AND rs.is_read = 1
       )`,
      [userId, userId],
    ),
  ]);

  return c.json({
    ok: true,
    data: {
      unreadCount: unreadRow?.count ?? 0,
      topArticles,
      latestBrief,
      upNextCount: upNextRow?.count ?? 0,
    },
  });
});
