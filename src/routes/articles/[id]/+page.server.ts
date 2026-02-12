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
    'SELECT summary_text, key_points_json FROM article_summaries WHERE article_id = ? ORDER BY created_at DESC LIMIT 1',
    [params.id]
  );

  const score = await dbGet(
    platform.env.DB,
    'SELECT score, label, reason_text, evidence_json FROM article_scores WHERE article_id = ? ORDER BY created_at DESC LIMIT 1',
    [params.id]
  );

  const feedback = await dbAll(
    platform.env.DB,
    'SELECT rating, comment, created_at FROM article_feedback WHERE article_id = ? ORDER BY created_at DESC',
    [params.id]
  );

  const preferredSource = await getPreferredSourceForArticle(platform.env.DB, params.id);
  const sources = await listSourcesForArticle(platform.env.DB, params.id);

  return { article, summary, score, feedback, preferredSource, sources };
};
