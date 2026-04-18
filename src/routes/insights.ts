import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import type { AppEnv } from '../index';
import { dbAll, dbGet, dbRun } from '../db/helpers';
import { resolveAIKey } from '../lib/ai-key-resolver';
import { runChat, type ChatMessage } from '../lib/ai';
import { recordUsage } from '../lib/rate-limiter';

export const insightsRoutes = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// GET /insights/topics — topic clusters for the user
// ---------------------------------------------------------------------------

insightsRoutes.get('/insights/topics', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;

  const clusters = await dbAll<{
    id: string;
    name: string;
    article_count: number;
    latest_article_at: number | null;
  }>(
    db,
    `SELECT id, name, article_count, latest_article_at
     FROM topic_clusters WHERE user_id = ?
     ORDER BY article_count DESC
     LIMIT 20`,
    [userId],
  );

  // Attach trend info if available.
  const result = [];
  for (const cluster of clusters) {
    const trend = await dbGet<{ trend_score: number; article_count_24h: number }>(
      db,
      `SELECT trend_score, article_count_24h FROM topic_trends
       WHERE cluster_id = ? AND user_id = ?
       ORDER BY created_at DESC LIMIT 1`,
      [cluster.id, userId],
    );

    result.push({
      ...cluster,
      trending: trend ? trend.trend_score >= 2.0 : false,
      trend_score: trend?.trend_score ?? null,
      articles_24h: trend?.article_count_24h ?? null,
    });
  }

  return c.json({ ok: true, data: result });
});

// ---------------------------------------------------------------------------
// GET /insights/trending — trending topics only
// ---------------------------------------------------------------------------

insightsRoutes.get('/insights/trending', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;

  const trends = await dbAll<{
    cluster_name: string;
    trend_score: number;
    article_count_24h: number;
    article_count_7d_avg: number;
  }>(
    db,
    `SELECT tc.name AS cluster_name, tt.trend_score, tt.article_count_24h, tt.article_count_7d_avg
     FROM topic_trends tt
     JOIN topic_clusters tc ON tc.id = tt.cluster_id
     WHERE tt.user_id = ? AND tt.trend_score >= 2.0
     ORDER BY tt.trend_score DESC
     LIMIT 10`,
    [userId],
  );

  return c.json({ ok: true, data: trends });
});

// ---------------------------------------------------------------------------
// GET /insights/weekly — reading insights for the current week
// ---------------------------------------------------------------------------

insightsRoutes.get('/insights/weekly', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;

  // Check for cached insight.
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const existing = await dbGet<{ insight_text: string; data_json: string | null; created_at: number }>(
    db,
    `SELECT insight_text, data_json, created_at FROM reading_insights
     WHERE user_id = ? AND insight_type = 'weekly' AND created_at >= ?
     ORDER BY created_at DESC LIMIT 1`,
    [userId, weekAgo],
  );

  if (existing) {
    return c.json({
      ok: true,
      data: {
        text: existing.insight_text,
        data: existing.data_json ? JSON.parse(existing.data_json) : null,
        generated_at: existing.created_at,
      },
    });
  }

  // Generate reading stats (no AI call — just data).
  const stats = await dbGet<{
    articles_read: number;
    total_articles: number;
  }>(
    db,
    `SELECT
       COUNT(CASE WHEN uas.is_read = 1 THEN 1 END) AS articles_read,
       COUNT(*) AS total_articles
     FROM article_read_state uas
     WHERE uas.user_id = ? AND uas.updated_at >= ?`,
    [userId, weekAgo],
  );

  const topTopics = await dbAll<{ name: string; cnt: number }>(
    db,
    `SELECT t.name, COUNT(DISTINCT at2.article_id) AS cnt
     FROM tags t
     JOIN article_tags at2 ON at2.tag_id = t.id
     JOIN article_read_state uas ON uas.article_id = at2.article_id AND uas.user_id = ?
     WHERE uas.is_read = 1 AND uas.updated_at >= ?
     GROUP BY t.id
     ORDER BY cnt DESC
     LIMIT 5`,
    [userId, weekAgo],
  );

  const topFeeds = await dbAll<{ title: string; cnt: number }>(
    db,
    `SELECT f.title, COUNT(DISTINCT uas.article_id) AS cnt
     FROM feeds f
     JOIN article_sources asrc ON asrc.feed_id = f.id
     JOIN article_read_state uas ON uas.article_id = asrc.article_id AND uas.user_id = ?
     WHERE uas.is_read = 1 AND uas.updated_at >= ?
     GROUP BY f.id
     ORDER BY cnt DESC
     LIMIT 5`,
    [userId, weekAgo],
  );

  const articlesRead = stats?.articles_read ?? 0;
  const dataPayload = {
    articles_read: articlesRead,
    top_topics: topTopics,
    top_feeds: topFeeds,
  };

  // Try AI-generated insight if provider available.
  let insightText: string;
  let insightProvider: string | null = null;
  let insightModel: string | null = null;

  const ai = await resolveAIKey(db, userId, c.req.raw, c.env);

  if (ai && articlesRead > 0) {
    const topicBreakdown = topTopics.map(t => `${t.name}: ${t.cnt} articles`).join(', ');
    const feedBreakdown = topFeeds.map(f => `${f.title}: ${f.cnt} articles`).join(', ');

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: 'You write brief, friendly reading insights for a news reader app. Keep it to 2-3 sentences. Be specific and observational, not generic.',
      },
      {
        role: 'user',
        content: `Generate a weekly reading insight from this data:\n\nArticles read: ${articlesRead}\nTop topics: ${topicBreakdown || 'None'}\nTop feeds: ${feedBreakdown || 'None'}\n\nMake it personal and insightful. Note any patterns, shifts, or interesting observations.`,
      },
    ];

    try {
      const { content, usage } = await runChat(ai.provider, ai.apiKey, ai.model, messages, { maxTokens: 200 });
      insightText = content.trim();
      insightProvider = ai.provider;
      insightModel = ai.model;
      await recordUsage(db, userId, ai.provider, ai.model, usage, 'insights', ai.isByok);
    } catch {
      // Fall back to template.
      const topicStr = topTopics.map(t => `${t.name} (${t.cnt})`).join(', ');
      const feedStr = topFeeds.map(f => `${f.title} (${f.cnt})`).join(', ');
      insightText = `You read ${articlesRead} articles this week.${topicStr ? ` Top topics: ${topicStr}.` : ''}${feedStr ? ` Most from: ${feedStr}.` : ''}`;
    }
  } else {
    const topicStr = topTopics.map(t => `${t.name} (${t.cnt})`).join(', ');
    const feedStr = topFeeds.map(f => `${f.title} (${f.cnt})`).join(', ');
    insightText = articlesRead > 0
      ? `You read ${articlesRead} articles this week.${topicStr ? ` Top topics: ${topicStr}.` : ''}${feedStr ? ` Most from: ${feedStr}.` : ''}`
      : 'No articles read this week. Check your feeds for new content!';
  }

  // Cache the insight.
  const now = Date.now();
  await dbRun(
    db,
    `INSERT INTO reading_insights (id, user_id, insight_type, insight_text, data_json, period_start, period_end, provider, model, created_at)
     VALUES (?, ?, 'weekly', ?, ?, ?, ?, ?, ?, ?)`,
    [nanoid(), userId, insightText, JSON.stringify(dataPayload), weekAgo, now, insightProvider, insightModel, now],
  );

  return c.json({
    ok: true,
    data: {
      text: insightText,
      data: dataPayload,
      generated_at: now,
    },
  });
});
