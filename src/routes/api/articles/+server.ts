import { json } from '@sveltejs/kit';
import { dbAll } from '$lib/server/db';
import { getPreferredSourcesForArticles } from '$lib/server/sources';

const sanitizeQuery = (value: string) => (value.toLowerCase().match(/\w+/g) ?? []).join(' ');

export const GET = async ({ url, platform }) => {
  const limit = Math.min(50, Number(url.searchParams.get('limit') ?? 20));
  const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0));
  const q = url.searchParams.get('q')?.trim() ?? '';
  const scoreFilter = url.searchParams.get('score') ?? 'all';
  const safeQuery = sanitizeQuery(q);

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (q) {
    conditions.push('article_search MATCH ?');
    params.push(safeQuery || q);
  }

  if (scoreFilter === 'unscored') {
    conditions.push(
      '(SELECT score FROM article_scores WHERE article_id = a.id ORDER BY created_at DESC LIMIT 1) IS NULL'
    );
  } else if (scoreFilter === '4plus') {
    conditions.push(
      '(SELECT score FROM article_scores WHERE article_id = a.id ORDER BY created_at DESC LIMIT 1) >= 4'
    );
  } else if (scoreFilter === '3plus') {
    conditions.push(
      '(SELECT score FROM article_scores WHERE article_id = a.id ORDER BY created_at DESC LIMIT 1) >= 3'
    );
  } else if (scoreFilter === 'low') {
    conditions.push(
      '(SELECT score FROM article_scores WHERE article_id = a.id ORDER BY created_at DESC LIMIT 1) <= 2'
    );
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const articles = await dbAll(
    platform.env.DB,
    `SELECT
      a.id,
      a.canonical_url,
      a.title,
      a.author,
      a.published_at,
      a.excerpt,
      a.word_count,
      (SELECT value FROM article_reactions WHERE article_id = a.id LIMIT 1) as reaction_value,
      (SELECT summary_text FROM article_summaries WHERE article_id = a.id ORDER BY created_at DESC LIMIT 1) as summary_text,
      (SELECT score FROM article_scores WHERE article_id = a.id ORDER BY created_at DESC LIMIT 1) as score,
      (SELECT label FROM article_scores WHERE article_id = a.id ORDER BY created_at DESC LIMIT 1) as score_label
    FROM articles a
    ${q ? 'JOIN article_search ON article_search.article_id = a.id' : ''}
    ${where}
    ORDER BY a.published_at DESC NULLS LAST, a.fetched_at DESC
    LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  const sourceByArticle = await getPreferredSourcesForArticles(
    platform.env.DB,
    articles.map((article: { id: string }) => article.id)
  );

  const hydratedArticles = articles.map((article: { id: string }) => {
    const source = sourceByArticle.get(article.id);
    return {
      ...article,
      source_name: source?.sourceName ?? null,
      source_feed_id: source?.feedId ?? null,
      source_reputation: source?.reputation ?? 0,
      source_feedback_count: source?.feedbackCount ?? 0
    };
  });

  return json({ articles: hydratedArticles });
};
