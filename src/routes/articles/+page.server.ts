import { dbAll } from '$lib/server/db';
import { getPreferredSourcesForArticles } from '$lib/server/sources';
import { listTags, listTagsForArticles, resolveTagsByTokens } from '$lib/server/tags';

const sanitizeQuery = (value: string) => (value.toLowerCase().match(/\w+/g) ?? []).join(' ');
const placeholders = (count: number) => Array.from({ length: count }, () => '?').join(', ');
const effectiveScoreExpr = `COALESCE(
  (SELECT score FROM article_score_overrides WHERE article_id = a.id LIMIT 1),
  (SELECT score FROM article_scores WHERE article_id = a.id ORDER BY created_at DESC LIMIT 1)
)`;
const effectiveReadExpr = `COALESCE(
  (SELECT is_read FROM article_read_state WHERE article_id = a.id LIMIT 1),
  0
)`;

export const load = async ({ platform, url }) => {
  const q = url.searchParams.get('q')?.trim() ?? '';
  const scoreFilter = url.searchParams.get('score') ?? 'all';
  const readFilter = url.searchParams.get('read') ?? 'all';
  const requestedTagTokens = [
    ...new Set(
      url.searchParams
        .getAll('tags')
        .flatMap((entry) => entry.split(','))
        .map((entry) => entry.trim())
        .filter(Boolean)
    )
  ];
  const selectedTags = await resolveTagsByTokens(platform.env.DB, requestedTagTokens);
  const selectedTagIds = selectedTags.map((tag) => tag.id);
  const safeQuery = sanitizeQuery(q);

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (q) {
    conditions.push('article_search MATCH ?');
    params.push(safeQuery || q);
  }

  if (scoreFilter === 'unscored') {
    conditions.push(`${effectiveScoreExpr} IS NULL`);
  } else if (scoreFilter === '4plus') {
    conditions.push(`${effectiveScoreExpr} >= 4`);
  } else if (scoreFilter === '3plus') {
    conditions.push(`${effectiveScoreExpr} >= 3`);
  } else if (scoreFilter === 'low') {
    conditions.push(`${effectiveScoreExpr} <= 2`);
  }

  if (readFilter === 'unread') {
    conditions.push(`${effectiveReadExpr} = 0`);
  } else if (readFilter === 'read') {
    conditions.push(`${effectiveReadExpr} = 1`);
  }

  if (selectedTagIds.length > 0) {
    conditions.push(
      `(SELECT COUNT(DISTINCT atf.tag_id)
        FROM article_tags atf
        WHERE atf.article_id = a.id
          AND atf.tag_id IN (${placeholders(selectedTagIds.length)})) = ?`
    );
    params.push(...selectedTagIds);
    params.push(selectedTagIds.length);
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
      ${effectiveReadExpr} as is_read,
      (SELECT value FROM article_reactions WHERE article_id = a.id LIMIT 1) as reaction_value,
      (SELECT summary_text FROM article_summaries WHERE article_id = a.id ORDER BY created_at DESC LIMIT 1) as summary_text,
      ${effectiveScoreExpr} as score,
      CASE
        WHEN EXISTS (SELECT 1 FROM article_score_overrides WHERE article_id = a.id) THEN 'User corrected'
        ELSE (SELECT label FROM article_scores WHERE article_id = a.id ORDER BY created_at DESC LIMIT 1)
      END as score_label
    FROM articles a
    ${q ? 'JOIN article_search ON article_search.article_id = a.id' : ''}
    ${where}
    ORDER BY a.published_at DESC NULLS LAST, a.fetched_at DESC
    LIMIT 50`,
    params
  );

  const sourceByArticle = await getPreferredSourcesForArticles(
    platform.env.DB,
    articles.map((article: { id: string }) => article.id)
  );
  const tagsByArticle = await listTagsForArticles(
    platform.env.DB,
    articles.map((article: { id: string }) => article.id)
  );
  const availableTags = await listTags(platform.env.DB, { limit: 150 });

  const hydratedArticles = articles.map((article: { id: string }) => {
    const source = sourceByArticle.get(article.id);
    return {
      ...article,
      tags: tagsByArticle.get(article.id) ?? [],
      source_name: source?.sourceName ?? null,
      source_feed_id: source?.feedId ?? null,
      source_reputation: source?.reputation ?? 0,
      source_feedback_count: source?.feedbackCount ?? 0
    };
  });

  return { articles: hydratedArticles, q, scoreFilter, readFilter, availableTags, selectedTagIds };
};
