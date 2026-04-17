import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import type { AppEnv } from '../index';
import type { Env } from '../env';
import { dbGet, dbAll, dbRun } from '../db/helpers';
import { resolveAIKey } from '../lib/ai-key-resolver';
import { runChat, parseJsonResponse } from '../lib/ai';
import { recordUsage, checkBudget } from '../lib/rate-limiter';
import { scrapeAndExtract, type ScrapeProvider } from '../lib/scraper';
import {
  buildSummarizePrompt,
  buildKeyPointsPrompt,
  buildScorePrompt,
  buildAutoTagPrompt,
  buildSuggestedQuestionsPrompt,
} from '../lib/prompts';
import {
  truncateContent,
  normalizeParagraphSummary,
  normalizeKeyPoints,
  normalizeTagName,
  normalizeTagConfidence,
} from '../lib/normalizers';
import type { SummaryStyle, SummaryLength } from '../lib/prompts';

export const enrichRoutes = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type EnrichmentArticle = {
  id: string;
  title: string;
  canonical_url: string;
  content_text: string | null;
};

async function fetchArticle(
  db: D1Database,
  articleId: string,
): Promise<EnrichmentArticle> {
  const article = await dbGet<EnrichmentArticle>(
    db,
    `SELECT id, title, canonical_url, content_text FROM articles WHERE id = ?`,
    [articleId],
  );
  if (!article) throw new Error('Article not found');
  return article;
}

// If the RSS item arrived with no body (e.g. Anthropic feeds), transparently
// deep-fetch the canonical URL before running the AI action. Mirrors the
// cooldown logic in POST /articles/:id/fetch-content so repeated failures
// don't hammer Steel/Browserless.
const ENRICH_FETCH_COOLDOWN_MS = 60 * 60 * 1000;

async function fetchArticleWithContent(
  db: D1Database,
  env: Env,
  articleId: string,
): Promise<{ article: EnrichmentArticle; contentText: string }> {
  const article = await fetchArticle(db, articleId);
  const initialContent = truncateContent(article.content_text);
  if (initialContent) return { article, contentText: initialContent };

  const fetchState = await dbGet<{
    last_fetch_attempt_at: number | null;
    fetch_attempt_count: number | null;
  }>(
    db,
    `SELECT last_fetch_attempt_at, fetch_attempt_count FROM articles WHERE id = ?`,
    [articleId],
  );

  const now = Date.now();
  const lastAttempt = fetchState?.last_fetch_attempt_at ?? 0;
  const attempts = fetchState?.fetch_attempt_count ?? 0;
  if (lastAttempt && attempts > 1 && now - lastAttempt < ENRICH_FETCH_COOLDOWN_MS) {
    throw new Error('No article content');
  }

  const feedRow = await dbGet<{ scrape_provider: string | null }>(
    db,
    `SELECT f.scrape_provider FROM article_sources src
     JOIN feeds f ON f.id = src.feed_id
     WHERE src.article_id = ? AND f.scrape_provider IS NOT NULL
     LIMIT 1`,
    [articleId],
  );
  const preferredProvider = (feedRow?.scrape_provider as ScrapeProvider | null) ?? undefined;

  try {
    const result = await scrapeAndExtract(article.canonical_url, env, preferredProvider);
    await dbRun(
      db,
      `UPDATE articles SET
         content_html = ?, content_text = ?, excerpt = ?,
         word_count = ?, extraction_method = ?, extraction_quality = ?,
         title = COALESCE(?, title), author = COALESCE(?, author),
         image_url = COALESCE(?, image_url),
         last_fetch_attempt_at = ?,
         fetch_attempt_count = COALESCE(fetch_attempt_count, 0) + 1,
         last_fetch_error = NULL
       WHERE id = ?`,
      [
        result.contentHtml, result.contentText, result.excerpt,
        result.wordCount, result.extractionMethod, result.extractionQuality,
        result.title, result.author, result.imageUrl,
        now, articleId,
      ],
    );
    const fresh = truncateContent(result.contentText);
    if (!fresh) throw new Error('No article content');
    return {
      article: { ...article, content_text: result.contentText },
      contentText: fresh,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await dbRun(
      db,
      `UPDATE articles SET
         last_fetch_attempt_at = ?,
         fetch_attempt_count = COALESCE(fetch_attempt_count, 0) + 1,
         last_fetch_error = ?
       WHERE id = ?`,
      [now, errMsg.slice(0, 500), articleId],
    );
    throw new Error('No article content');
  }
}

// ---------------------------------------------------------------------------
// POST /enrich/:articleId/summarize
// ---------------------------------------------------------------------------

enrichRoutes.post('/enrich/:articleId/summarize', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  const articleId = c.req.param('articleId');

  const ai = await resolveAIKey(db, userId, c.req.raw, c.env);
  if (!ai) return c.json({ ok: false, error: { code: 'no_ai_key', message: 'No AI provider configured' } }, 503);

  const { article, contentText } = await fetchArticleWithContent(db, c.env, articleId);

  // Load user's summary preferences.
  const styleRow = await dbGet<{ value: string }>(db, `SELECT value FROM settings WHERE user_id = ? AND key = 'summaryStyle'`, [userId]);
  const lengthRow = await dbGet<{ value: string }>(db, `SELECT value FROM settings WHERE user_id = ? AND key = 'summaryLength'`, [userId]);
  const style = (styleRow?.value ?? 'concise') as SummaryStyle;
  const length = (lengthRow?.value ?? 'short') as SummaryLength;

  const messages = buildSummarizePrompt(
    article.title,
    article.canonical_url,
    contentText,
    style,
    length,
  );

  const { content, usage } = await runChat(ai.provider, ai.apiKey, ai.model, messages);

  const parsed = parseJsonResponse(content) as Record<string, unknown> | null;
  const rawSummary =
    typeof parsed?.summary === 'string' ? parsed.summary : content.trim();
  const summary = normalizeParagraphSummary(rawSummary);

  const now = Date.now();
  await dbRun(
    db,
    `INSERT INTO article_summaries (id, article_id, summary_text, length_category, style, provider, model, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [nanoid(), articleId, summary, length, style, ai.provider, ai.model, now],
  );

  await recordUsage(db, userId, ai.provider, ai.model, usage, 'summarize', ai.isByok);

  return c.json({ ok: true, data: { summary_text: summary } });
});

// ---------------------------------------------------------------------------
// POST /enrich/:articleId/key-points
// ---------------------------------------------------------------------------

enrichRoutes.post('/enrich/:articleId/key-points', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  const articleId = c.req.param('articleId');

  const ai = await resolveAIKey(db, userId, c.req.raw, c.env);
  if (!ai) return c.json({ ok: false, error: { code: 'no_ai_key', message: 'No AI provider configured' } }, 503);

  const { article, contentText } = await fetchArticleWithContent(db, c.env, articleId);

  const messages = buildKeyPointsPrompt(
    article.title,
    article.canonical_url,
    contentText,
  );

  const { content } = await runChat(ai.provider, ai.apiKey, ai.model, messages);

  const parsed = parseJsonResponse(content) as Record<string, unknown> | null;
  const keyPoints = normalizeKeyPoints(parsed?.key_points ?? content);

  const now = Date.now();
  await dbRun(
    db,
    `INSERT INTO article_key_points (id, article_id, key_points_json, provider, model, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [nanoid(), articleId, JSON.stringify(keyPoints), ai.provider, ai.model, now],
  );

  return c.json({ ok: true, data: { key_points: keyPoints } });
});

// ---------------------------------------------------------------------------
// POST /enrich/:articleId/score
// ---------------------------------------------------------------------------

enrichRoutes.post('/enrich/:articleId/score', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  const articleId = c.req.param('articleId');

  const ai = await resolveAIKey(db, userId, c.req.raw, c.env);
  if (!ai) return c.json({ ok: false, error: { code: 'no_ai_key', message: 'No AI provider configured' } }, 503);

  const article = await fetchArticle(db, articleId);

  // Get user's preference profile.
  const profile = await dbGet<{ profile_text: string; version: number }>(
    db,
    `SELECT profile_text, version FROM preference_profiles WHERE user_id = ? LIMIT 1`,
    [userId],
  );

  const profileText = profile?.profile_text ?? 'No preferences set.';

  const contentText = truncateContent(article.content_text);
  const now = Date.now();

  if (!contentText) {
    // Insert a default score when there's no content to analyze.
    await dbRun(
      db,
      `INSERT INTO article_scores (id, article_id, user_id, score, label, reason_text, evidence_json, score_status, scoring_method, profile_version, provider, model, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [nanoid(), articleId, userId, 3, 'No content', 'Article content was not available for scoring.', '[]', 'done', 'ai', profile?.version ?? null, ai.provider, ai.model, now],
    );
    return c.json({ ok: true, data: { score: 3, label: 'No content', reason: 'Article content was not available for scoring.', evidence: [] } });
  }

  const messages = buildScorePrompt(
    article.title,
    article.canonical_url,
    contentText,
    profileText,
  );

  const { content } = await runChat(ai.provider, ai.apiKey, ai.model, messages);

  const parsed = (parseJsonResponse(content) as Record<string, unknown>) ?? {};
  const score = Math.min(5, Math.max(1, Number(parsed.score) || 3));
  const label = typeof parsed.label === 'string' ? parsed.label : 'Neutral fit';
  const reason = typeof parsed.reason === 'string' ? parsed.reason : content.trim();
  const evidence = Array.isArray(parsed.evidence) ? parsed.evidence : [];

  await dbRun(
    db,
    `INSERT INTO article_scores (id, article_id, user_id, score, label, reason_text, evidence_json, score_status, scoring_method, profile_version, provider, model, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [nanoid(), articleId, userId, score, label, reason, JSON.stringify(evidence), 'done', 'ai', profile?.version ?? null, ai.provider, ai.model, now],
  );

  return c.json({ ok: true, data: { score, label, reason, evidence } });
});

// ---------------------------------------------------------------------------
// GET /enrich/:articleId/suggest-questions — return cached suggestions (or empty)
// ---------------------------------------------------------------------------

enrichRoutes.get('/enrich/:articleId/suggest-questions', async (c) => {
  // No persistent storage for suggested questions yet — return empty array.
  return c.json({ ok: true, data: [] });
});

// ---------------------------------------------------------------------------
// POST /enrich/:articleId/suggest-questions
// ---------------------------------------------------------------------------

enrichRoutes.post('/enrich/:articleId/suggest-questions', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  const articleId = c.req.param('articleId');

  const ai = await resolveAIKey(db, userId, c.req.raw, c.env);
  if (!ai) return c.json({ ok: false, error: { code: 'no_ai_key', message: 'No AI provider configured' } }, 503);

  const article = await fetchArticle(db, articleId);

  const contentText = truncateContent(article.content_text);
  if (!contentText) {
    return c.json({ ok: true, data: [] });
  }

  // Pull the most recent summary for richer context (optional).
  const summaryRow = await dbGet<{ summary_text: string }>(
    db,
    `SELECT summary_text FROM article_summaries WHERE article_id = ? ORDER BY created_at DESC LIMIT 1`,
    [articleId],
  );

  const messages = buildSuggestedQuestionsPrompt(
    article.title,
    article.canonical_url,
    contentText,
    summaryRow?.summary_text ?? null,
  );

  const { content } = await runChat(
    ai.provider,
    ai.apiKey,
    ai.model,
    messages,
    { maxTokens: 256 },
  );

  const parsed = (parseJsonResponse(content) as Record<string, unknown>) ?? {};
  const questions = Array.isArray(parsed.questions)
    ? parsed.questions
        .filter((q: unknown): q is string => typeof q === 'string')
        .slice(0, 3)
    : [];

  // Return without storing (no article_suggested_questions table yet).
  return c.json({ ok: true, data: questions });
});

// ---------------------------------------------------------------------------
// POST /enrich/:articleId/auto-tag
// ---------------------------------------------------------------------------

enrichRoutes.post('/enrich/:articleId/auto-tag', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  const articleId = c.req.param('articleId');

  const ai = await resolveAIKey(db, userId, c.req.raw, c.env);
  if (!ai) return c.json({ ok: false, error: { code: 'no_ai_key', message: 'No AI provider configured' } }, 503);

  const { article, contentText } = await fetchArticleWithContent(db, c.env, articleId);

  // Get existing tags for candidate matching.
  const existingTags = await dbAll<{ id: string; name: string }>(
    db,
    `SELECT id, name FROM tags LIMIT 50`,
  );

  const candidates = existingTags.map((t) => ({ id: t.id, name: t.name }));

  const messages = buildAutoTagPrompt(
    article.title,
    article.canonical_url,
    contentText,
    candidates,
    5,
  );

  const { content } = await runChat(ai.provider, ai.apiKey, ai.model, messages);

  const parsed = (parseJsonResponse(content) as Record<string, unknown>) ?? {};
  const allowedIds = new Set(candidates.map((c) => c.id));

  // Matched existing tags -> article_tags.
  const matchedIds = Array.isArray(parsed.matched_existing_tag_ids)
    ? (parsed.matched_existing_tag_ids as string[]).filter((id) => allowedIds.has(id))
    : [];

  const now = Date.now();
  for (const tagId of matchedIds) {
    await dbRun(
      db,
      `INSERT INTO article_tags (article_id, tag_id, user_id, source, created_at)
       VALUES (?, ?, ?, 'auto', ?)
       ON CONFLICT (article_id, tag_id, user_id) DO UPDATE SET source = 'auto'`,
      [articleId, tagId, userId, now],
    );
  }

  // New suggestions -> article_tag_suggestions.
  const newSuggestions = Array.isArray(parsed.new_suggestions)
    ? parsed.new_suggestions
    : [];

  for (const suggestion of newSuggestions) {
    const row = suggestion as Record<string, unknown>;
    const name = normalizeTagName(row.name ?? row.tag ?? row.label);
    const confidence = normalizeTagConfidence(row.confidence ?? row.score);
    if (!name) continue;

    await dbRun(
      db,
      `INSERT INTO article_tag_suggestions (id, article_id, user_id, name, source, confidence, created_at)
       VALUES (?, ?, ?, ?, 'auto', ?, ?)
       ON CONFLICT (article_id, user_id, name) DO UPDATE SET confidence = excluded.confidence`,
      [nanoid(), articleId, userId, name, confidence, now],
    );
  }

  return c.json({
    ok: true,
    data: {
      matched_tag_ids: matchedIds,
      new_suggestions: newSuggestions.map((s: unknown) => {
        const row = s as Record<string, unknown>;
        return {
          name: normalizeTagName(row.name ?? row.tag ?? row.label),
          confidence: normalizeTagConfidence(row.confidence ?? row.score),
        };
      }).filter((s: { name: string }) => s.name),
    },
  });
});

// ---------------------------------------------------------------------------
// POST /enrich/batch — batch enrichment (summarize + key-points) for BYOK users
//
// Accepts an array of article IDs and processes them sequentially.
// Returns an SSE stream of results as each article completes.
// ---------------------------------------------------------------------------

enrichRoutes.post('/enrich/batch', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;

  const body = await c.req.json<{ article_ids: string[] }>();
  const articleIds = body.article_ids ?? [];
  if (articleIds.length === 0 || articleIds.length > 20) {
    return c.json({ ok: false, error: { code: 'bad_request', message: 'Provide 1-20 article IDs' } }, 400);
  }

  const ai = await resolveAIKey(db, userId, c.req.raw, c.env);
  if (!ai) return c.json({ ok: false, error: { code: 'no_ai_key', message: 'No AI provider configured' } }, 503);

  // Budget check for non-BYOK.
  if (!ai.isByok) {
    const budget = await checkBudget(db, userId);
    if (!budget.allowed) {
      return c.json({ ok: false, error: { code: 'budget_exceeded', message: 'Budget exceeded' } }, 429);
    }
  }

  // Load user settings for summary style.
  const settings = await dbGet<{ value: string }>(
    db,
    `SELECT value FROM settings WHERE user_id = ? AND key = 'summaryStyle'`,
    [userId],
  );
  const summaryStyle = (settings?.value ?? 'concise') as SummaryStyle;
  const summaryLength: SummaryLength = 'short';

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      for (const articleId of articleIds) {
        try {
          const article = await dbGet<EnrichmentArticle>(
            db,
            `SELECT id, title, canonical_url, content_text FROM articles WHERE id = ?`,
            [articleId],
          );
          if (!article || !article.content_text) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'skip', article_id: articleId, reason: 'not_found' })}\n\n`));
            continue;
          }

          const content = truncateContent(article.content_text, 12_000);

          // Summarize.
          const sumPrompt = buildSummarizePrompt(article.title, article.canonical_url, content, summaryStyle, summaryLength);
          const { content: sumRaw, usage: sumUsage } = await runChat(ai.provider, ai.apiKey, ai.model, sumPrompt, { maxTokens: 400 });
          const sumParsed = parseJsonResponse(sumRaw) as Record<string, unknown> | null;
          if (sumParsed) {
            const summaryText = normalizeParagraphSummary(String(sumParsed.summary ?? sumParsed.paragraph ?? ''));
            await dbRun(db,
              `INSERT INTO article_summaries (id, article_id, summary_text, length_category, style, provider, model, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              [nanoid(), articleId, summaryText, summaryLength, summaryStyle, ai.provider, ai.model, Date.now()],
            );
          }
          await recordUsage(db, userId, ai.provider, ai.model, sumUsage, 'enrich_batch', ai.isByok);

          // Key points.
          const kpPrompt = buildKeyPointsPrompt(article.title, article.canonical_url, content, summaryLength);
          const { content: kpRaw, usage: kpUsage } = await runChat(ai.provider, ai.apiKey, ai.model, kpPrompt, { maxTokens: 300 });
          const kpParsed = parseJsonResponse(kpRaw) as Record<string, unknown> | null;
          if (kpParsed) {
            const rawPoints = (kpParsed.key_points ?? kpParsed.keyPoints ?? []) as unknown[];
            const keyPoints = normalizeKeyPoints(rawPoints);
            await dbRun(db,
              `INSERT INTO article_key_points (id, article_id, key_points_json, provider, model, created_at)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [nanoid(), articleId, JSON.stringify(keyPoints), ai.provider, ai.model, Date.now()],
            );
          }
          await recordUsage(db, userId, ai.provider, ai.model, kpUsage, 'enrich_batch', ai.isByok);

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done', article_id: articleId, title: article.title })}\n\n`));
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown error';
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', article_id: articleId, error: msg })}\n\n`));
        }
      }

      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'complete', total: articleIds.length })}\n\n`));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
});
