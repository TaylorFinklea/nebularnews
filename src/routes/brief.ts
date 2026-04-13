import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import type { AppEnv } from '../index';
import { dbGet, dbAll, dbRun } from '../db/helpers';
import { resolveAIKey } from '../lib/ai-key-resolver';
import { runChat, parseJsonResponse } from '../lib/ai';
import { buildNewsBriefPrompt } from '../lib/prompts';
import { recordUsage } from '../lib/rate-limiter';

export const briefRoutes = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_LOOKBACK_HOURS = 12;
const DEFAULT_SCORE_CUTOFF = 3;
const MAX_ARTICLES = 20;

type BriefDepth = 'headlines' | 'summary' | 'deep';

function maxWordsForDepth(depth: BriefDepth): number {
  switch (depth) {
    case 'headlines': return 8;
    case 'summary': return 18;
    case 'deep': return 50;
  }
}

function maxBulletsForDepth(depth: BriefDepth): number {
  switch (depth) {
    case 'headlines': return 8;
    case 'summary': return 5;
    case 'deep': return 4;
  }
}

// ---------------------------------------------------------------------------
// POST /brief/generate — generate a news brief (supports per-topic + depth)
//
// Body (all optional):
//   topic_tag_id: string — filter to articles with this tag
//   depth: 'headlines' | 'summary' | 'deep' — configurable detail level
//   lookback_hours: number — override user setting
// ---------------------------------------------------------------------------

briefRoutes.post('/brief/generate', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;

  const body = await c.req.json<{
    topic_tag_id?: string;
    depth?: BriefDepth;
    lookback_hours?: number;
  }>().catch(() => ({ topic_tag_id: undefined, depth: undefined, lookback_hours: undefined }));

  const depth: BriefDepth = body.depth ?? 'summary';
  const topicTagId = body.topic_tag_id ?? null;

  const ai = await resolveAIKey(db, userId, c.req.raw, c.env);
  if (!ai) return c.json({ ok: false, error: { code: 'no_ai_key', message: 'No AI provider configured' } }, 503);

  // Load user's brief settings.
  const lookbackSetting = await dbGet<{ value: string }>(db, `SELECT value FROM user_settings WHERE user_id = ? AND key = 'newsBriefLookbackHours'`, [userId]);
  const cutoffSetting = await dbGet<{ value: string }>(db, `SELECT value FROM user_settings WHERE user_id = ? AND key = 'newsBriefScoreCutoff'`, [userId]);
  const lookbackHours = body.lookback_hours ?? (parseInt(lookbackSetting?.value ?? '') || DEFAULT_LOOKBACK_HOURS);
  const scoreCutoff = parseInt(cutoffSetting?.value ?? '') || DEFAULT_SCORE_CUTOFF;

  // Get user's subscribed (non-paused) feed IDs.
  const subFeeds = await dbAll<{ feed_id: string }>(
    db,
    `SELECT feed_id FROM user_feed_subscriptions WHERE user_id = ? AND paused = 0`,
    [userId],
  );

  if (subFeeds.length === 0) {
    return c.json({ ok: true, data: { brief: null, reason: 'No subscribed feeds' } });
  }

  const feedIds = subFeeds.map((s) => s.feed_id);
  const placeholders = feedIds.map(() => '?').join(', ');

  // Get recent article IDs from subscribed feeds within the lookback window.
  const cutoffMs = Date.now() - lookbackHours * 3_600_000;
  const sources = await dbAll<{ article_id: string; feed_id: string }>(
    db,
    `SELECT DISTINCT src.article_id, src.feed_id
     FROM article_sources src
     WHERE src.feed_id IN (${placeholders})
       AND src.created_at >= ?`,
    [...feedIds, cutoffMs],
  );

  if (sources.length === 0) {
    return c.json({ ok: true, data: { brief: null, reason: 'No recent articles' } });
  }

  const articleIds = [...new Set(sources.map((s) => s.article_id))];
  const articlePlaceholders = articleIds.map(() => '?').join(', ');

  // Build article-to-feed map.
  const articleFeedMap = new Map<string, string>();
  for (const src of sources) {
    if (!articleFeedMap.has(src.article_id)) {
      articleFeedMap.set(src.article_id, src.feed_id);
    }
  }

  // If topic filter, narrow to articles with that tag.
  let filteredArticleIds = articleIds;
  if (topicTagId) {
    const taggedRows = await dbAll<{ article_id: string }>(
      db,
      `SELECT article_id FROM article_tags WHERE tag_id = ? AND article_id IN (${articlePlaceholders})`,
      [topicTagId, ...articleIds],
    );
    filteredArticleIds = taggedRows.map(r => r.article_id);
    if (filteredArticleIds.length === 0) {
      return c.json({ ok: true, data: { brief: null, reason: 'No articles matching topic' } });
    }
  }

  const filteredPlaceholders = filteredArticleIds.map(() => '?').join(', ');

  // Get scores for these articles (only those meeting cutoff).
  const scores = await dbAll<{ article_id: string; score: number }>(
    db,
    `SELECT article_id, score FROM article_scores
     WHERE user_id = ? AND article_id IN (${filteredPlaceholders}) AND score >= ?
     ORDER BY score DESC`,
    [userId, ...filteredArticleIds, scoreCutoff],
  );

  if (scores.length === 0) {
    return c.json({ ok: true, data: { brief: null, reason: 'No articles meeting score cutoff' } });
  }

  const scoreMap = new Map<string, number>();
  for (const s of scores) {
    scoreMap.set(s.article_id, s.score);
  }

  const scoredArticleIds = scores
    .slice(0, MAX_ARTICLES)
    .map((s) => s.article_id);

  const scoredPlaceholders = scoredArticleIds.map(() => '?').join(', ');

  // Fetch article data.
  const articles = await dbAll<{
    id: string;
    title: string | null;
    published_at: number | null;
    fetched_at: number | null;
  }>(
    db,
    `SELECT id, title, published_at, fetched_at FROM articles WHERE id IN (${scoredPlaceholders})`,
    scoredArticleIds,
  );

  if (articles.length === 0) {
    return c.json({ ok: true, data: { brief: null, reason: 'No articles found' } });
  }

  // Fetch summaries and feed titles for context.
  const candidatePromises = articles.map(async (article) => {
    const [summaryRow, feedRow] = await Promise.all([
      dbGet<{ summary_text: string }>(
        db,
        `SELECT summary_text FROM article_summaries WHERE article_id = ? ORDER BY created_at DESC LIMIT 1`,
        [article.id],
      ),
      dbGet<{ title: string }>(
        db,
        `SELECT title FROM feeds WHERE id = ?`,
        [articleFeedMap.get(article.id) ?? ''],
      ),
    ]);

    return {
      id: article.id,
      title: article.title ?? 'Untitled',
      sourceName: feedRow?.title ?? null,
      publishedAt: article.published_at ?? article.fetched_at ?? null,
      effectiveScore: scoreMap.get(article.id) ?? 3,
      context: summaryRow?.summary_text ?? '',
    };
  });

  const candidates = await Promise.all(candidatePromises);

  // Sort candidates: highest score first, then most recent.
  candidates.sort((a, b) => {
    if (b.effectiveScore !== a.effectiveScore) {
      return b.effectiveScore - a.effectiveScore;
    }
    return (b.publishedAt ?? 0) - (a.publishedAt ?? 0);
  });

  const hour = new Date().getUTCHours();
  const windowLabel = hour < 12 ? 'Morning Brief' : 'Evening Brief';

  // Call AI with depth-aware bullet count.
  const maxBullets = maxBulletsForDepth(depth);
  const maxWords = maxWordsForDepth(depth);
  const messages = buildNewsBriefPrompt(candidates, windowLabel, maxBullets, maxWords);
  const { content, usage } = await runChat(ai.provider, ai.apiKey, ai.model, messages);

  const parsed = parseJsonResponse(content) as Record<string, unknown> | null;
  const bullets = Array.isArray(parsed?.bullets) ? parsed!.bullets : [];

  // Save to news_brief_editions.
  const editionType = hour < 12 ? 'morning' : 'evening';
  const briefText = JSON.stringify(bullets);
  const articleIdsJson = JSON.stringify(candidates.map((c) => c.id));
  const briefId = nanoid();
  const now = Date.now();

  await dbRun(
    db,
    `INSERT INTO news_brief_editions (id, user_id, edition_type, brief_text, article_ids_json, provider, model, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [briefId, userId, editionType, briefText, articleIdsJson, ai.provider, ai.model, now],
  );

  await recordUsage(db, userId, ai.provider, ai.model, usage, 'brief', ai.isByok);

  return c.json({
    ok: true,
    data: {
      state: 'done',
      title: 'News Brief',
      edition_label: editionType === 'morning' ? 'Morning' : 'Evening',
      generated_at: now,
      window_hours: lookbackHours,
      score_cutoff: scoreCutoff,
      depth,
      topic_tag_id: topicTagId,
      bullets,
      next_scheduled_at: null,
      stale: false,
    },
  });
});
