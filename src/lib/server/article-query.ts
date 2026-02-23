import { dbAll, dbGet, type Db } from './db';
import { getPreferredSourcesForArticles } from './sources';
import { listTagsForArticles } from './tags';

export const SCORE_VALUES = ['5', '4', '3', '2', '1', 'unscored'] as const;
export const REACTION_VALUES = ['up', 'down', 'none'] as const;
export const SORT_VALUES = ['newest', 'oldest', 'score_desc', 'score_asc', 'unread_first', 'title_az'] as const;

export type ScoreValue = (typeof SCORE_VALUES)[number];
export type ReactionValue = (typeof REACTION_VALUES)[number];
export type SortValue = (typeof SORT_VALUES)[number];

export type ArticleQueryInput = {
  query?: string;
  limit: number;
  offset: number;
  selectedScores: ScoreValue[];
  selectedReactions: ReactionValue[];
  readFilter: 'all' | 'read' | 'unread';
  sort: SortValue;
  selectedTagIds: string[];
  groupedByPublishedAt?: boolean;
};

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
const reactionExpr = '(SELECT value FROM article_reactions WHERE article_id = a.id LIMIT 1)';

const sortOrderClause = (sort: SortValue) => {
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
};

const buildWhere = (input: ArticleQueryInput) => {
  const query = input.query?.trim() ?? '';
  const safeQuery = sanitizeQuery(query);

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (query) {
    conditions.push('article_search MATCH ?');
    params.push(safeQuery || query);
  }

  if (input.selectedScores.length < SCORE_VALUES.length) {
    const scoreConditions: string[] = [];
    const numericScores = input.selectedScores.filter((value) => value !== 'unscored').map((value) => Number(value));
    if (numericScores.length > 0) {
      scoreConditions.push(`${effectiveScoreExpr} IN (${placeholders(numericScores.length)})`);
      params.push(...numericScores);
    }
    if (input.selectedScores.includes('unscored')) {
      scoreConditions.push(`${effectiveScoreExpr} IS NULL`);
    }
    if (scoreConditions.length > 0) conditions.push(`(${scoreConditions.join(' OR ')})`);
  }

  if (input.readFilter === 'unread') conditions.push(`${effectiveReadExpr} = 0`);
  if (input.readFilter === 'read') conditions.push(`${effectiveReadExpr} = 1`);

  if (input.selectedReactions.length < REACTION_VALUES.length) {
    const reactionConditions: string[] = [];
    if (input.selectedReactions.includes('up')) reactionConditions.push(`${reactionExpr} = 1`);
    if (input.selectedReactions.includes('down')) reactionConditions.push(`${reactionExpr} = -1`);
    if (input.selectedReactions.includes('none')) reactionConditions.push(`${reactionExpr} IS NULL`);
    if (reactionConditions.length > 0) conditions.push(`(${reactionConditions.join(' OR ')})`);
  }

  if (input.selectedTagIds.length > 0) {
    conditions.push(
      `(SELECT COUNT(DISTINCT atf.tag_id)
         FROM article_tags atf
        WHERE atf.article_id = a.id
          AND atf.tag_id IN (${placeholders(input.selectedTagIds.length)})) = ?`
    );
    params.push(...input.selectedTagIds);
    params.push(input.selectedTagIds.length);
  }

  return {
    query,
    where: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params
  };
};

export const listArticlesWithFilters = async (db: Db, input: ArticleQueryInput) => {
  const clauses = buildWhere(input);
  const join = clauses.query ? 'JOIN article_search ON article_search.article_id = a.id' : '';
  const orderBy = input.groupedByPublishedAt
    ? 'COALESCE(a.published_at, a.fetched_at) DESC, a.fetched_at DESC'
    : sortOrderClause(input.sort);

  const totalRow = await dbGet<{ count: number }>(
    db,
    `SELECT COUNT(*) as count
     FROM articles a
     ${join}
     ${clauses.where}`,
    clauses.params
  );

  const rows = await dbAll<{
    id: string;
    canonical_url: string | null;
    image_url: string | null;
    title: string | null;
    author: string | null;
    published_at: number | null;
    fetched_at: number | null;
    excerpt: string | null;
    word_count: number | null;
    is_read: number;
    reaction_value: number | null;
    summary_text: string | null;
    score: number | null;
    score_label: string | null;
  }>(
    db,
    `SELECT
      a.id,
      a.canonical_url,
      a.image_url,
      a.title,
      a.author,
      a.published_at,
      a.fetched_at,
      a.excerpt,
      a.word_count,
      ${effectiveReadExpr} as is_read,
      ${reactionExpr} as reaction_value,
      (SELECT summary_text FROM article_summaries WHERE article_id = a.id ORDER BY created_at DESC LIMIT 1) as summary_text,
      ${effectiveScoreExpr} as score,
      CASE
        WHEN EXISTS (SELECT 1 FROM article_score_overrides WHERE article_id = a.id) THEN 'User corrected'
        ELSE (SELECT label FROM article_scores WHERE article_id = a.id ORDER BY created_at DESC LIMIT 1)
      END as score_label
    FROM articles a
    ${join}
    ${clauses.where}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?`,
    [...clauses.params, input.limit, input.offset]
  );

  const articleIds = rows.map((row) => row.id);
  const sourceByArticle = await getPreferredSourcesForArticles(db, articleIds);
  const tagsByArticle = await listTagsForArticles(db, articleIds);

  const articles = rows.map((row) => {
    const source = sourceByArticle.get(row.id);
    return {
      ...row,
      image_url: row.image_url ?? null,
      tags: tagsByArticle.get(row.id) ?? [],
      source: source
        ? {
            feed_id: source.feedId,
            name: source.sourceName,
            reputation: source.reputation,
            feedback_count: source.feedbackCount,
            feed_url: source.feedUrl,
            feed_site_url: source.feedSiteUrl
          }
        : null,
      // Backward-compatible aliases.
      source_name: source?.sourceName ?? null,
      source_feed_id: source?.feedId ?? null,
      source_reputation: source?.reputation ?? 0,
      source_feedback_count: source?.feedbackCount ?? 0
    };
  });

  return {
    total: Number(totalRow?.count ?? 0),
    articles
  };
};
