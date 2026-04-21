import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { dbGet, dbAll } from '../db/helpers';
import { resolveAIKey } from '../lib/ai-key-resolver';
import { runChat, parseJsonResponse } from '../lib/ai';
import { buildNewsBriefPrompt } from '../lib/prompts';
import { recordUsage } from '../lib/rate-limiter';
import { persistBrief } from '../lib/brief-persist';

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

  let body: { topic_tag_id?: string; depth?: BriefDepth; lookback_hours?: number } = {};
  try {
    // Clone the request before reading body — Hono may have already read it.
    const cloned = c.req.raw.clone();
    const text = await cloned.text();
    if (text && text.trim()) {
      body = JSON.parse(text);
    }
  } catch { /* empty body is fine — use defaults */ }

  try {

  const depth: BriefDepth = body.depth ?? 'summary';
  const topicTagId = body.topic_tag_id ?? null;

  const ai = await resolveAIKey(db, userId, c.req.raw, c.env);
  if (!ai) return c.json({ ok: false, error: { code: 'no_ai_key', message: 'No AI provider configured' } }, 503);

  // Load user's brief settings.
  const [lookbackSetting, cutoffSetting] = await Promise.all([
    dbGet<{ value: string }>(db, `SELECT value FROM settings WHERE user_id = ? AND key = 'newsBriefLookbackHours'`, [userId]),
    dbGet<{ value: string }>(db, `SELECT value FROM settings WHERE user_id = ? AND key = 'newsBriefScoreCutoff'`, [userId]),
  ]);
  const lookbackHours = body.lookback_hours ?? (parseInt(lookbackSetting?.value ?? '') || DEFAULT_LOOKBACK_HOURS);
  const scoreCutoff = parseInt(cutoffSetting?.value ?? '') || DEFAULT_SCORE_CUTOFF;
  const cutoffMs = Date.now() - lookbackHours * 3_600_000;

  // Single JOIN query — replaces the chain of IN-clause queries that blow past
  // D1's ~100 SQL variable limit when a user has many feeds or a long lookback window.
  // Variable count is constant (5-6) regardless of data volume.
  const topicClause = topicTagId
    ? `AND EXISTS (SELECT 1 FROM article_tags at2 WHERE at2.article_id = a.id AND at2.tag_id = ?)`
    : '';
  const params: unknown[] = [userId, userId, cutoffMs, scoreCutoff];
  if (topicTagId) params.push(topicTagId);
  params.push(MAX_ARTICLES);

  const rows = await dbAll<{
    id: string; title: string | null;
    published_at: number | null; fetched_at: number | null;
    score: number; feed_title: string | null;
  }>(db, `
    SELECT
      a.id, a.title, a.published_at, a.fetched_at,
      MAX(COALESCE(s.score, 0)) AS score,
      (SELECT f.title FROM feeds f
         JOIN article_sources src2 ON src2.feed_id = f.id
         WHERE src2.article_id = a.id
         ORDER BY src2.created_at ASC
         LIMIT 1) AS feed_title
    FROM article_sources src
    JOIN user_feed_subscriptions ufs ON ufs.feed_id = src.feed_id AND ufs.user_id = ? AND ufs.paused = 0
    JOIN articles a ON a.id = src.article_id
    LEFT JOIN article_scores s ON s.article_id = src.article_id AND s.user_id = ?
    WHERE src.created_at >= ?
      AND COALESCE(s.score, 0) >= ?
      ${topicClause}
    GROUP BY a.id
    ORDER BY score DESC, COALESCE(a.published_at, a.fetched_at) DESC
    LIMIT ?
  `, params);

  if (rows.length === 0) {
    return c.json({ ok: true, data: { state: 'empty', title: 'News Brief', edition_label: '', generated_at: Date.now(), window_hours: lookbackHours, score_cutoff: scoreCutoff, bullets: [], next_scheduled_at: null, stale: false } });
  }

  // Fetch summaries for top articles. Bounded by MAX_ARTICLES so no IN-clause risk.
  const candidates = await Promise.all(rows.map(async (row) => {
    const summaryRow = await dbGet<{ summary_text: string }>(
      db,
      `SELECT summary_text FROM article_summaries WHERE article_id = ? ORDER BY created_at DESC LIMIT 1`,
      [row.id],
    );
    return {
      id: row.id,
      title: row.title ?? 'Untitled',
      sourceName: row.feed_title ?? null,
      publishedAt: row.published_at ?? row.fetched_at ?? null,
      effectiveScore: row.score,
      context: summaryRow?.summary_text ?? '',
    };
  }));

  const hour = new Date().getUTCHours();
  const windowLabel = hour < 12 ? 'Morning Brief' : 'Evening Brief';

  // Call AI with depth-aware bullet count.
  const maxBullets = maxBulletsForDepth(depth);
  const maxWords = maxWordsForDepth(depth);
  const messages = buildNewsBriefPrompt(candidates, windowLabel, maxBullets, maxWords);
  const { content, usage } = await runChat(ai.provider, ai.apiKey, ai.model, messages);

  const parsed = parseJsonResponse(content) as Record<string, unknown> | null;
  const rawBullets = Array.isArray(parsed?.bullets) ? (parsed!.bullets as Array<{ text?: string; source_article_ids?: string[] }>) : [];

  // Enrich bullets with article metadata for the iOS client.
  const candidateMap = new Map(candidates.map(c => [c.id, c]));
  const bullets = rawBullets.map(b => {
    const sourceIds = b.source_article_ids ?? [];
    const sources = sourceIds
      .map(id => candidateMap.get(id))
      .filter(Boolean)
      .map(a => ({ article_id: a!.id, title: a!.title, canonical_url: null }));
    return { text: b.text ?? '', sources };
  });

  const editionType = hour < 12 ? 'morning' : 'evening';
  const now = Date.now();

  await recordUsage(db, userId, ai.provider, ai.model, usage, 'brief', ai.isByok);

  // Persist the brief so /today can return it on next app open. Failures here
  // shouldn't break the user-facing response — log and continue.
  try {
    const tzRow = await dbGet<{ value: string }>(
      db,
      `SELECT value FROM settings WHERE user_id = ? AND key = 'newsBriefTimezone'`,
      [userId],
    );
    await persistBrief(db, {
      userId,
      editionKind: editionType,
      editionSlot: `ondemand-${now}`,
      timezone: tzRow?.value || 'UTC',
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
  } catch (e) {
    console.error('[brief/generate] persistBrief failed:', e instanceof Error ? e.message : e);
  }

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

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[brief/generate] Error:', msg, err);
    return c.json({ ok: false, error: { code: 'internal_error', message: msg } }, 500);
  }
});
