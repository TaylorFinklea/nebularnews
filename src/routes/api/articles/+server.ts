import { json } from '@sveltejs/kit';
import { dbAll } from '$lib/server/db';
import { extractLeadImageUrlFromHtml } from '$lib/server/images';
import { getPreferredSourcesForArticles } from '$lib/server/sources';
import { listTagsForArticles, resolveTagsByTokens } from '$lib/server/tags';

const sanitizeQuery = (value: string) => (value.toLowerCase().match(/\w+/g) ?? []).join(' ');
const placeholders = (count: number) => Array.from({ length: count }, () => '?').join(', ');
const SCORE_VALUES = ['5', '4', '3', '2', '1', 'unscored'] as const;
type ScoreValue = (typeof SCORE_VALUES)[number];
const REACTION_VALUES = ['up', 'down', 'none'] as const;
type ReactionValue = (typeof REACTION_VALUES)[number];
const SORT_VALUES = ['newest', 'oldest', 'score_desc', 'score_asc', 'unread_first', 'title_az'] as const;
type SortValue = (typeof SORT_VALUES)[number];
const effectiveScoreExpr = `COALESCE(
  (SELECT score FROM article_score_overrides WHERE article_id = a.id LIMIT 1),
  (SELECT score FROM article_scores WHERE article_id = a.id ORDER BY created_at DESC LIMIT 1)
)`;
const effectiveReadExpr = `COALESCE(
  (SELECT is_read FROM article_read_state WHERE article_id = a.id LIMIT 1),
  0
)`;

export const GET = async ({ url, platform }) => {
  const limit = Math.min(50, Number(url.searchParams.get('limit') ?? 20));
  const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0));
  const q = url.searchParams.get('q')?.trim() ?? '';
  const selectedScores = (() => {
    const requested = [
      ...new Set(
        url.searchParams
          .getAll('score')
          .flatMap((entry) => entry.split(','))
          .map((entry) => entry.trim().toLowerCase())
          .filter(Boolean)
      )
    ];
    const expanded = requested.flatMap((value) => {
      if (value === 'all') return [...SCORE_VALUES];
      if (value === '4plus') return ['5', '4'] as ScoreValue[];
      if (value === '3plus') return ['5', '4', '3'] as ScoreValue[];
      if (value === 'low') return ['2', '1'] as ScoreValue[];
      if (value === 'unscored') return ['unscored'] as ScoreValue[];
      return [value];
    });
    const valid = [...new Set(expanded)].filter((value): value is ScoreValue =>
      SCORE_VALUES.includes(value as ScoreValue)
    );
    return valid.length > 0 ? valid : [...SCORE_VALUES];
  })();
  const readFilter = url.searchParams.get('read') ?? 'all';
  const sort = (() => {
    const value = (url.searchParams.get('sort') ?? 'newest').trim().toLowerCase();
    return SORT_VALUES.includes(value as SortValue) ? (value as SortValue) : 'newest';
  })();
  const selectedReactions = (() => {
    const requested = [
      ...new Set(
        url.searchParams
          .getAll('reaction')
          .flatMap((entry) => entry.split(','))
          .map((entry) => entry.trim().toLowerCase())
          .filter(Boolean)
      )
    ];
    const valid = requested.filter((value): value is ReactionValue =>
      REACTION_VALUES.includes(value as ReactionValue)
    );
    return valid.length > 0 ? valid : [...REACTION_VALUES];
  })();
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

  if (selectedScores.length < SCORE_VALUES.length) {
    const scoreConditions: string[] = [];
    const numericScores = selectedScores.filter((value) => value !== 'unscored').map((value) => Number(value));
    if (numericScores.length > 0) {
      scoreConditions.push(`${effectiveScoreExpr} IN (${placeholders(numericScores.length)})`);
      params.push(...numericScores);
    }
    if (selectedScores.includes('unscored')) {
      scoreConditions.push(`${effectiveScoreExpr} IS NULL`);
    }
    if (scoreConditions.length > 0) {
      conditions.push(`(${scoreConditions.join(' OR ')})`);
    }
  }

  if (readFilter === 'unread') {
    conditions.push(`${effectiveReadExpr} = 0`);
  } else if (readFilter === 'read') {
    conditions.push(`${effectiveReadExpr} = 1`);
  }

  const reactionExpr = '(SELECT value FROM article_reactions WHERE article_id = a.id LIMIT 1)';
  if (selectedReactions.length < REACTION_VALUES.length) {
    const reactionConditions: string[] = [];
    if (selectedReactions.includes('up')) reactionConditions.push(`${reactionExpr} = 1`);
    if (selectedReactions.includes('down')) reactionConditions.push(`${reactionExpr} = -1`);
    if (selectedReactions.includes('none')) reactionConditions.push(`${reactionExpr} IS NULL`);
    if (reactionConditions.length > 0) {
      conditions.push(`(${reactionConditions.join(' OR ')})`);
    }
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
  const orderBy = (() => {
    if (sort === 'oldest') return 'COALESCE(a.published_at, a.fetched_at) ASC';
    if (sort === 'score_desc') {
      return `CASE WHEN ${effectiveScoreExpr} IS NULL THEN 1 ELSE 0 END ASC, ${effectiveScoreExpr} DESC, a.published_at DESC NULLS LAST, a.fetched_at DESC`;
    }
    if (sort === 'score_asc') {
      return `CASE WHEN ${effectiveScoreExpr} IS NULL THEN 1 ELSE 0 END ASC, ${effectiveScoreExpr} ASC, a.published_at DESC NULLS LAST, a.fetched_at DESC`;
    }
    if (sort === 'unread_first') {
      return `${effectiveReadExpr} ASC, a.published_at DESC NULLS LAST, a.fetched_at DESC`;
    }
    if (sort === 'title_az') {
      return `COALESCE(a.title, '') COLLATE NOCASE ASC, a.published_at DESC NULLS LAST, a.fetched_at DESC`;
    }
    return 'a.published_at DESC NULLS LAST, a.fetched_at DESC';
  })();

  const articles = await dbAll(
    platform.env.DB,
    `SELECT
      a.id,
      a.canonical_url,
      a.image_url,
      a.content_html,
      a.title,
      a.author,
      a.published_at,
      a.excerpt,
      a.word_count,
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
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  const sourceByArticle = await getPreferredSourcesForArticles(
    platform.env.DB,
    articles.map((article: { id: string }) => article.id)
  );
  const tagsByArticle = await listTagsForArticles(
    platform.env.DB,
    articles.map((article: { id: string }) => article.id)
  );

  const hydratedArticles = articles.map((article: {
    id: string;
    image_url?: string | null;
    content_html?: string | null;
    canonical_url?: string | null;
  }) => {
    const source = sourceByArticle.get(article.id);
    const extractedImage =
      !article.image_url && article.content_html
        ? extractLeadImageUrlFromHtml(article.content_html, article.canonical_url ?? null)
        : null;
    const { content_html: _contentHtml, ...rest } = article as { content_html?: string | null } & Record<string, unknown>;
    return {
      ...rest,
      image_url: article.image_url ?? extractedImage ?? null,
      tags: tagsByArticle.get(article.id) ?? [],
      source_name: source?.sourceName ?? null,
      source_feed_id: source?.feedId ?? null,
      source_reputation: source?.reputation ?? 0,
      source_feedback_count: source?.feedbackCount ?? 0
    };
  });

  return json({ articles: hydratedArticles, readFilter, sort, selectedScores, selectedReactions, selectedTagIds });
};
