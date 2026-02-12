import { json } from '@sveltejs/kit';
import { dbAll, dbGet } from '$lib/server/db';
import { getPreferredSourceForArticle, listSourcesForArticle } from '$lib/server/sources';

export const GET = async ({ params, platform }) => {
  const { id } = params;
  const article = await dbGet(
    platform.env.DB,
    'SELECT id, canonical_url, title, author, published_at, fetched_at, content_html, content_text, excerpt, word_count FROM articles WHERE id = ?',
    [id]
  );
  if (!article) return json({ error: 'Not found' }, { status: 404 });

  const summary = await dbGet(
    platform.env.DB,
    'SELECT summary_text, key_points_json, provider, model, created_at FROM article_summaries WHERE article_id = ? ORDER BY created_at DESC LIMIT 1',
    [id]
  );

  const score = await dbGet(
    platform.env.DB,
    'SELECT score, label, reason_text, evidence_json, created_at FROM article_scores WHERE article_id = ? ORDER BY created_at DESC LIMIT 1',
    [id]
  );

  const feedback = await dbAll(
    platform.env.DB,
    'SELECT rating, comment, created_at FROM article_feedback WHERE article_id = ? ORDER BY created_at DESC',
    [id]
  );

  const preferredSource = await getPreferredSourceForArticle(platform.env.DB, id);
  const sources = await listSourcesForArticle(platform.env.DB, id);

  return json({ article, summary, score, feedback, preferredSource, sources });
};
