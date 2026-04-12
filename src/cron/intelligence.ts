import { nanoid } from 'nanoid';
import type { Env } from '../env';
import { dbAll, dbGet, dbRun } from '../db/helpers';

// ---------------------------------------------------------------------------
// Daily intelligence cron — topic clustering + trend detection
//
// Runs once daily. For each user:
// 1. Cluster articles by tag co-occurrence
// 2. Detect trends by comparing 24h vs 7d activity
// ---------------------------------------------------------------------------

export async function runIntelligence(env: Env): Promise<void> {
  const db = env.DB;
  const now = Date.now();

  const users = await dbAll<{ id: string }>(db, `SELECT id FROM user LIMIT 100`);

  for (const user of users) {
    try {
      await buildTopicClusters(db, user.id, now);
      await detectTrends(db, user.id, now);
    } catch {
      // Continue to next user on error.
    }
  }
}

// ---------------------------------------------------------------------------
// Topic clustering: group articles by shared tags
// ---------------------------------------------------------------------------

async function buildTopicClusters(
  db: D1Database,
  userId: string,
  now: number,
): Promise<void> {
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

  // Find tags with 2+ articles in the last 7 days for this user.
  const activeTags = await dbAll<{
    tag_id: string;
    tag_name: string;
    article_count: number;
    latest_at: number;
  }>(
    db,
    `SELECT t.id AS tag_id, t.name AS tag_name,
            COUNT(DISTINCT at2.article_id) AS article_count,
            MAX(COALESCE(a.published_at, a.fetched_at)) AS latest_at
     FROM tags t
     JOIN article_tags at2 ON at2.tag_id = t.id
     JOIN articles a ON a.id = at2.article_id
     JOIN user_feed_subscriptions ufs ON ufs.feed_id = a.feed_id AND ufs.user_id = ?
     WHERE COALESCE(a.published_at, a.fetched_at) >= ?
     GROUP BY t.id
     HAVING article_count >= 2
     ORDER BY article_count DESC
     LIMIT 20`,
    [userId, sevenDaysAgo],
  );

  if (activeTags.length === 0) return;

  // Clear old clusters for this user and rebuild.
  await dbRun(db, `DELETE FROM topic_clusters WHERE user_id = ?`, [userId]);

  // Each active tag becomes a cluster (simple approach — tag = topic).
  for (const tag of activeTags) {
    await dbRun(
      db,
      `INSERT INTO topic_clusters (id, user_id, name, tag_ids_json, article_count, latest_article_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        nanoid(), userId, tag.tag_name,
        JSON.stringify([tag.tag_id]),
        tag.article_count, tag.latest_at, now, now,
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Trend detection: compare 24h activity vs 7d daily average
// ---------------------------------------------------------------------------

async function detectTrends(
  db: D1Database,
  userId: string,
  now: number,
): Promise<void> {
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

  const clusters = await dbAll<{
    id: string;
    name: string;
    tag_ids_json: string;
  }>(
    db,
    `SELECT id, name, tag_ids_json FROM topic_clusters WHERE user_id = ?`,
    [userId],
  );

  // Clear old trends.
  await dbRun(db, `DELETE FROM topic_trends WHERE user_id = ?`, [userId]);

  for (const cluster of clusters) {
    let tagIds: string[];
    try {
      tagIds = JSON.parse(cluster.tag_ids_json);
    } catch {
      continue;
    }
    if (tagIds.length === 0) continue;

    const placeholders = tagIds.map(() => '?').join(',');

    // Count articles in last 24h.
    const recent = await dbGet<{ cnt: number }>(
      db,
      `SELECT COUNT(DISTINCT at2.article_id) AS cnt
       FROM article_tags at2
       JOIN articles a ON a.id = at2.article_id
       JOIN user_feed_subscriptions ufs ON ufs.feed_id = a.feed_id AND ufs.user_id = ?
       WHERE at2.tag_id IN (${placeholders})
         AND COALESCE(a.published_at, a.fetched_at) >= ?`,
      [userId, ...tagIds, oneDayAgo],
    );

    // Count articles in last 7 days.
    const weekly = await dbGet<{ cnt: number }>(
      db,
      `SELECT COUNT(DISTINCT at2.article_id) AS cnt
       FROM article_tags at2
       JOIN articles a ON a.id = at2.article_id
       JOIN user_feed_subscriptions ufs ON ufs.feed_id = a.feed_id AND ufs.user_id = ?
       WHERE at2.tag_id IN (${placeholders})
         AND COALESCE(a.published_at, a.fetched_at) >= ?`,
      [userId, ...tagIds, sevenDaysAgo],
    );

    const count24h = recent?.cnt ?? 0;
    const count7d = weekly?.cnt ?? 0;
    const dailyAvg7d = count7d / 7;

    // Trending if 24h count exceeds 7d daily average by 2x+.
    const trendScore = dailyAvg7d > 0 ? count24h / dailyAvg7d : 0;

    if (trendScore >= 1.5) {
      await dbRun(
        db,
        `INSERT INTO topic_trends (id, cluster_id, user_id, trend_score, article_count_24h, article_count_7d_avg, window_start, window_end, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [nanoid(), cluster.id, userId, trendScore, count24h, dailyAvg7d, oneDayAgo, now, now],
      );
    }
  }
}
