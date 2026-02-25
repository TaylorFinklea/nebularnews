import { json } from '@sveltejs/kit';
import { dbAll, dbGet } from '$lib/server/db';
import { getPreferredSourceForArticle, listSourcesForArticle } from '$lib/server/sources';
import { listTagSuggestionsForArticle, listTagsForArticle } from '$lib/server/tags';

export const GET = async ({ params, platform }) => {
  const { id } = params;
  const article = await dbGet(
    platform.env.DB,
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
      COALESCE((SELECT is_read FROM article_read_state WHERE article_id = articles.id LIMIT 1), 0) as is_read
    FROM articles
    WHERE id = ?`,
    [id]
  );
  if (!article) return json({ error: 'Not found' }, { status: 404 });

  const summary = await dbGet(
    platform.env.DB,
    'SELECT summary_text, provider, model, created_at FROM article_summaries WHERE article_id = ? ORDER BY created_at DESC LIMIT 1',
    [id]
  );

  const keyPoints = await dbGet(
    platform.env.DB,
    'SELECT key_points_json, provider, model, created_at FROM article_key_points WHERE article_id = ? ORDER BY created_at DESC LIMIT 1',
    [id]
  );

  const scoreOverride = await dbGet<{ score: number; comment: string | null; updated_at: number }>(
    platform.env.DB,
    'SELECT score, comment, updated_at FROM article_score_overrides WHERE article_id = ? LIMIT 1',
    [id]
  );
  const aiScore = await dbGet<{
    score: number;
    label: string | null;
    reason_text: string | null;
    evidence_json: string | null;
    created_at: number;
  }>(
    platform.env.DB,
    'SELECT score, label, reason_text, evidence_json, created_at FROM article_scores WHERE article_id = ? ORDER BY created_at DESC LIMIT 1',
    [id]
  );
  const score = scoreOverride
    ? {
        score: scoreOverride.score,
        label: 'User corrected',
        reason_text: scoreOverride.comment ?? 'User-set rating override',
        evidence_json: null,
        created_at: scoreOverride.updated_at,
        source: 'user'
      }
    : aiScore
      ? {
          ...aiScore,
          source: 'ai'
        }
      : null;

  const feedback = await dbAll(
    platform.env.DB,
    'SELECT rating, comment, created_at FROM article_feedback WHERE article_id = ? ORDER BY created_at DESC',
    [id]
  );
  const reaction = await dbGet(
    platform.env.DB,
    'SELECT value, feed_id, created_at FROM article_reactions WHERE article_id = ? LIMIT 1',
    [id]
  );

  const preferredSource = await getPreferredSourceForArticle(platform.env.DB, id);
  const sources = await listSourcesForArticle(platform.env.DB, id);
  const tags = await listTagsForArticle(platform.env.DB, id);
  const tagSuggestions = await listTagSuggestionsForArticle(platform.env.DB, id);

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
    tagSuggestions,
    tag_suggestions: tagSuggestions
  });
};
