import { json } from '@sveltejs/kit';
import { dbAll, dbGet } from '$lib/server/db';
import { requireMobileAccess } from '$lib/server/mobile/auth';
import { getReactionForArticle } from '$lib/server/reactions';
import { getPreferredSourceForArticle, listSourcesForArticle } from '$lib/server/sources';
import { listTagSuggestionsForArticle, listTagsForArticle } from '$lib/server/tags';

export const GET = async ({ params, request, platform, locals }) => {
  const { user } = await requireMobileAccess(request, platform.env, locals.db, 'app:read');

  const { id } = params;
  const article = await dbGet(
    locals.db,
    `SELECT
      id,
      canonical_url,
      image_url,
      title,
      author,
      published_at,
      fetched_at,
      content_html,
      content_text,
      excerpt,
      word_count,
      COALESCE((SELECT is_read FROM article_read_state WHERE article_id = articles.id AND user_id = ? LIMIT 1), 0) as is_read
    FROM articles
    WHERE id = ?`,
    [user.id, id]
  );
  if (!article) return json({ error: 'Not found' }, { status: 404 });

  const summary = await dbGet(
    locals.db,
    'SELECT summary_text, provider, model, created_at FROM article_summaries WHERE article_id = ? ORDER BY created_at DESC LIMIT 1',
    [id]
  );
  const keyPoints = await dbGet(
    locals.db,
    'SELECT key_points_json, provider, model, created_at FROM article_key_points WHERE article_id = ? ORDER BY created_at DESC LIMIT 1',
    [id]
  );
  const scoreOverride = await dbGet<{ score: number; comment: string | null; updated_at: number }>(
    locals.db,
    'SELECT score, comment, updated_at FROM article_score_overrides WHERE article_id = ? AND user_id = ? LIMIT 1',
    [id, user.id]
  );
  const aiScore = await dbGet<{
    score: number;
    label: string | null;
    reason_text: string | null;
    evidence_json: string | null;
    created_at: number;
    score_status: 'ready' | 'insufficient_signal' | null;
    confidence: number | null;
    preference_confidence: number | null;
    weighted_average: number | null;
  }>(
    locals.db,
    `SELECT
      score,
      label,
      reason_text,
      evidence_json,
      created_at,
      score_status,
      confidence,
      preference_confidence,
      weighted_average
     FROM article_scores
     WHERE article_id = ?
     ORDER BY created_at DESC
     LIMIT 1`,
    [id]
  );
  const score = scoreOverride
    ? {
        score: scoreOverride.score,
        label: 'User corrected',
        reason_text: scoreOverride.comment ?? 'User-set rating override',
        evidence_json: null,
        created_at: scoreOverride.updated_at,
        source: 'user',
        status: 'ready',
        confidence: 1,
        preference_confidence: 1,
        weighted_average: null
      }
    : aiScore
      ? {
          ...aiScore,
          source: 'ai',
          status: aiScore.score_status ?? 'ready'
        }
      : null;

  const feedback = await dbAll(
    locals.db,
    'SELECT rating, comment, created_at FROM article_feedback WHERE article_id = ? ORDER BY created_at DESC',
    [id]
  );
  const reaction = await getReactionForArticle(locals.db, user.id, id);
  const preferredSource = await getPreferredSourceForArticle(locals.db, id);
  const sources = await listSourcesForArticle(locals.db, id);
  const tags = await listTagsForArticle(locals.db, user.id, id);
  const tagSuggestions = await listTagSuggestionsForArticle(locals.db, user.id, id);

  return json({
    article,
    summary,
    keyPoints,
    score,
    feedback,
    reaction,
    preferredSource,
    sources,
    tags,
    tagSuggestions
  });
};
