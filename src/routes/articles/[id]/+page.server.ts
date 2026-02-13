import { dbAll, dbGet } from '$lib/server/db';
import { getPreferredSourceForArticle, listSourcesForArticle } from '$lib/server/sources';

export const load = async ({ params, platform }) => {
  const article = await dbGet(
    platform.env.DB,
    'SELECT id, canonical_url, title, author, published_at, content_html, content_text FROM articles WHERE id = ?',
    [params.id]
  );

  const summary = await dbGet(
    platform.env.DB,
    'SELECT summary_text, key_points_json, provider, model, created_at, prompt_version FROM article_summaries WHERE article_id = ? ORDER BY created_at DESC LIMIT 1',
    [params.id]
  );

  const scoreOverride = await dbGet<{ score: number; comment: string | null; updated_at: number }>(
    platform.env.DB,
    'SELECT score, comment, updated_at FROM article_score_overrides WHERE article_id = ? LIMIT 1',
    [params.id]
  );
  const aiScore = await dbGet<{ score: number; label: string | null; reason_text: string | null; evidence_json: string | null }>(
    platform.env.DB,
    'SELECT score, label, reason_text, evidence_json FROM article_scores WHERE article_id = ? ORDER BY created_at DESC LIMIT 1',
    [params.id]
  );
  const score = scoreOverride
    ? {
        score: scoreOverride.score,
        label: 'User corrected',
        reason_text: scoreOverride.comment ?? 'User-set rating override',
        evidence_json: null,
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
    [params.id]
  );
  const reaction = await dbGet(
    platform.env.DB,
    'SELECT value, feed_id, created_at FROM article_reactions WHERE article_id = ? LIMIT 1',
    [params.id]
  );

  const preferredSource = await getPreferredSourceForArticle(platform.env.DB, params.id);
  const sources = await listSourcesForArticle(platform.env.DB, params.id);

  return { article, summary, score, feedback, reaction, preferredSource, sources };
};
