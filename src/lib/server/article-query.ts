import { dbAll, dbGet, type Db } from './db';
import { listReactionReasonCodesForArticles } from './reactions';
import { getPreferredSourcesForArticles } from './sources';
import { listTagSuggestionsForArticles, listTagsForArticles } from './tags';

export const SCORE_VALUES = ['5', '4', '3', '2', '1', 'learning', 'unscored'] as const;
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
  minPublishedAt?: number | null;
  groupedByPublishedAt?: boolean;
  savedOnly?: boolean;
};

const sanitizeQuery = (value: string) => (value.toLowerCase().match(/\w+/g) ?? []).join(' ');
const placeholders = (count: number) => Array.from({ length: count }, () => '?').join(', ');

// Score expressions are shared (article_scores has no user_id)
const latestScoreExpr = `(SELECT score FROM article_scores WHERE article_id = a.id ORDER BY created_at DESC LIMIT 1)`;
const latestScoreLabelExpr = `(SELECT label FROM article_scores WHERE article_id = a.id ORDER BY created_at DESC LIMIT 1)`;
const latestScoreStatusExpr = `(SELECT score_status FROM article_scores WHERE article_id = a.id ORDER BY created_at DESC LIMIT 1)`;
const latestScoreConfidenceExpr = `(SELECT confidence FROM article_scores WHERE article_id = a.id ORDER BY created_at DESC LIMIT 1)`;
const latestScorePreferenceConfidenceExpr = `(SELECT preference_confidence FROM article_scores WHERE article_id = a.id ORDER BY created_at DESC LIMIT 1)`;

// User-scoped expression builders — userId is embedded as a quoted literal in subqueries.
// Safe because userId is a server-generated nanoid, never user input.
const escUid = (uid: string) => uid.replace(/'/g, "''");
const overrideExistsExpr = (uid: string) => `EXISTS (SELECT 1 FROM article_score_overrides WHERE article_id = a.id AND user_id = '${escUid(uid)}')`;
const effectiveScoreExpr = (uid: string) => `COALESCE(
  (SELECT score FROM article_score_overrides WHERE article_id = a.id AND user_id = '${escUid(uid)}' LIMIT 1),
  CASE WHEN ${latestScoreStatusExpr} = 'ready' THEN ${latestScoreExpr} ELSE NULL END
)`;
const effectiveReadExpr = (uid: string) => `COALESCE(
  (SELECT is_read FROM article_read_state WHERE article_id = a.id AND user_id = '${escUid(uid)}' LIMIT 1), 0
)`;
const reactionExpr = (uid: string) => `(SELECT value FROM article_reactions WHERE article_id = a.id AND user_id = '${escUid(uid)}' LIMIT 1)`;
const savedExpr = (uid: string) => `(SELECT saved_at FROM article_read_state WHERE article_id = a.id AND user_id = '${escUid(uid)}' LIMIT 1)`;
const subscriptionFilter = (uid: string) => `EXISTS (
  SELECT 1 FROM article_sources src
  JOIN user_feed_subscriptions ufs ON ufs.feed_id = src.feed_id
  WHERE src.article_id = a.id AND ufs.user_id = '${escUid(uid)}'
)`;

const sortOrderClause = (sort: SortValue, uid: string) => {
  if (sort === 'oldest') return 'COALESCE(a.published_at, a.fetched_at) ASC';
  if (sort === 'score_desc') {
    return `CASE WHEN ${effectiveScoreExpr(uid)} IS NULL THEN 1 ELSE 0 END ASC, ${effectiveScoreExpr(uid)} DESC, a.published_at DESC NULLS LAST, a.fetched_at DESC`;
  }
  if (sort === 'score_asc') {
    return `CASE WHEN ${effectiveScoreExpr(uid)} IS NULL THEN 1 ELSE 0 END ASC, ${effectiveScoreExpr(uid)} ASC, a.published_at DESC NULLS LAST, a.fetched_at DESC`;
  }
  if (sort === 'unread_first') {
    return `${effectiveReadExpr(uid)} ASC, a.published_at DESC NULLS LAST, a.fetched_at DESC`;
  }
  if (sort === 'title_az') {
    return `COALESCE(a.title, '') COLLATE NOCASE ASC, a.published_at DESC NULLS LAST, a.fetched_at DESC`;
  }
  return 'a.published_at DESC NULLS LAST, a.fetched_at DESC';
};

const buildWhere = (input: ArticleQueryInput & { userId: string }) => {
  const query = input.query?.trim() ?? '';
  const safeQuery = sanitizeQuery(query);

  const conditions: string[] = [];
  const params: unknown[] = [];

  const uid = input.userId;

  // Subscription filter — only show articles from feeds the user subscribes to
  conditions.push(subscriptionFilter(uid));

  if (query) {
    conditions.push('article_search MATCH ?');
    params.push(safeQuery || query);
  }

  if (Number.isFinite(input.minPublishedAt) && Number(input.minPublishedAt) > 0) {
    conditions.push('COALESCE(a.published_at, a.fetched_at, 0) >= ?');
    params.push(Math.round(Number(input.minPublishedAt)));
  }

  if (input.selectedScores.length < SCORE_VALUES.length) {
    const scoreConditions: string[] = [];
    const numericScores = input.selectedScores
      .filter((value) => value !== 'learning' && value !== 'unscored')
      .map((value) => Number(value));
    if (numericScores.length > 0) {
      scoreConditions.push(`${effectiveScoreExpr(uid)} IN (${placeholders(numericScores.length)})`);
      params.push(...numericScores);
    }
    if (input.selectedScores.includes('learning')) {
      scoreConditions.push(`${latestScoreStatusExpr} = 'insufficient_signal'`);
    }
    if (input.selectedScores.includes('unscored')) {
      scoreConditions.push(`(${effectiveScoreExpr(uid)} IS NULL AND COALESCE(${latestScoreStatusExpr}, '') != 'insufficient_signal')`);
    }
    if (scoreConditions.length > 0) conditions.push(`(${scoreConditions.join(' OR ')})`);
  }

  if (input.readFilter === 'unread') conditions.push(`${effectiveReadExpr(uid)} = 0`);
  if (input.readFilter === 'read') conditions.push(`${effectiveReadExpr(uid)} = 1`);

  if (input.savedOnly) {
    conditions.push(`${savedExpr(uid)} IS NOT NULL`);
  }

  if (input.selectedReactions.length < REACTION_VALUES.length) {
    const reactionConditions: string[] = [];
    if (input.selectedReactions.includes('up')) reactionConditions.push(`${reactionExpr(uid)} = 1`);
    if (input.selectedReactions.includes('down')) reactionConditions.push(`${reactionExpr(uid)} = -1`);
    if (input.selectedReactions.includes('none')) reactionConditions.push(`${reactionExpr(uid)} IS NULL`);
    if (reactionConditions.length > 0) conditions.push(`(${reactionConditions.join(' OR ')})`);
  }

  if (input.selectedTagIds.length > 0) {
    conditions.push(
      `(SELECT COUNT(DISTINCT atf.tag_id) FROM article_tags atf
        WHERE atf.article_id = a.id AND atf.user_id = '${escUid(uid)}'
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

export const listArticlesWithFilters = async (db: Db, userId: string, input: ArticleQueryInput) => {
  const clauses = buildWhere({ ...input, userId });
  const join = clauses.query ? 'JOIN article_search ON article_search.article_id = a.id' : '';
  const orderBy = input.groupedByPublishedAt
    ? 'COALESCE(a.published_at, a.fetched_at) DESC, a.fetched_at DESC'
    : sortOrderClause(input.sort, userId);

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
    score_status: 'ready' | 'insufficient_signal' | null;
    score_confidence: number | null;
    score_preference_confidence: number | null;
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
      ${effectiveReadExpr(userId)} as is_read,
      ${reactionExpr(userId)} as reaction_value,
      (SELECT summary_text FROM article_summaries WHERE article_id = a.id ORDER BY created_at DESC LIMIT 1) as summary_text,
      ${effectiveScoreExpr(userId)} as score,
      CASE
        WHEN ${overrideExistsExpr(userId)} THEN 'User corrected'
        ELSE ${latestScoreLabelExpr}
      END as score_label,
      CASE
        WHEN ${overrideExistsExpr(userId)} THEN 'ready'
        ELSE ${latestScoreStatusExpr}
      END as score_status,
      CASE
        WHEN ${overrideExistsExpr(userId)} THEN 1.0
        ELSE ${latestScoreConfidenceExpr}
      END as score_confidence,
      CASE
        WHEN ${overrideExistsExpr(userId)} THEN 1.0
        ELSE ${latestScorePreferenceConfidenceExpr}
      END as score_preference_confidence
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
  const suggestionsByArticle = await listTagSuggestionsForArticles(db, articleIds);
  const reactionReasonsByArticle = await listReactionReasonCodesForArticles(db, articleIds);

  const articles = rows.map((row) => {
    const source = sourceByArticle.get(row.id);
    return {
      ...row,
      image_url: row.image_url ?? null,
      reaction_reason_codes: reactionReasonsByArticle.get(row.id) ?? [],
      tags: tagsByArticle.get(row.id) ?? [],
      tag_suggestions: suggestionsByArticle.get(row.id) ?? [],
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
