import { nanoid } from 'nanoid';
import { dbAll, dbGet, dbRun, now, type Db } from '$lib/server/db';
import { getManualPullState, runManualPull } from '$lib/server/manual-pull';
import { getPreferredSourceForArticle, getPreferredSourcesForArticles, listSourcesForArticle } from '$lib/server/sources';
import { listTagsForArticle, listTagsForArticles, resolveTagsByTokens } from '$lib/server/tags';
import { normalizeUrl } from '$lib/server/urls';

const SCORE_VALUES = ['5', '4', '3', '2', '1', 'unscored'] as const;
const REACTION_VALUES = ['up', 'down', 'none'] as const;
const SORT_VALUES = ['newest', 'oldest', 'score_desc', 'score_asc', 'unread_first', 'title_az'] as const;
const READ_VALUES = ['all', 'read', 'unread'] as const;
const REPUTATION_PRIOR_WEIGHT = 5;

type ScoreValue = (typeof SCORE_VALUES)[number];
type ReactionValue = (typeof REACTION_VALUES)[number];
type SortValue = (typeof SORT_VALUES)[number];
type ReadValue = (typeof READ_VALUES)[number];

const DEFAULT_FETCH_MAX_CHARS = 12000;
const DEFAULT_CONTEXT_SOURCES = 5;
const DEFAULT_CONTEXT_SOURCE_CHARS = 2400;
const MAX_FETCH_MAX_CHARS = 30000;
const MAX_LIMIT = 50;
const MAX_OFFSET = 10000;
const MAX_CONTEXT_SOURCES = 10;
const MAX_CONTEXT_SOURCE_CHARS = 5000;

const effectiveScoreExpr = `COALESCE(
  (SELECT score FROM article_score_overrides WHERE article_id = a.id LIMIT 1),
  (SELECT score FROM article_scores WHERE article_id = a.id ORDER BY created_at DESC LIMIT 1)
)`;

const effectiveReadExpr = `COALESCE(
  (SELECT is_read FROM article_read_state WHERE article_id = a.id LIMIT 1),
  0
)`;

const reactionExpr = '(SELECT value FROM article_reactions WHERE article_id = a.id LIMIT 1)';

const placeholders = (count: number) => Array.from({ length: count }, () => '?').join(', ');
const sanitizeQuery = (value: string) => (value.toLowerCase().match(/\w+/g) ?? []).join(' ');

const clampInt = (value: unknown, min: number, max: number, fallback: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
};

const clampRead = (value: unknown): ReadValue =>
  READ_VALUES.includes(value as ReadValue) ? (value as ReadValue) : 'all';

const clampSort = (value: unknown): SortValue =>
  SORT_VALUES.includes(value as SortValue) ? (value as SortValue) : 'newest';

const truncateText = (value: string, maxChars: number) => {
  if (value.length <= maxChars) return value;
  const cutoff = Math.max(0, maxChars - 3);
  return `${value.slice(0, cutoff)}...`;
};

export const truncateForMcp = (value: string | null | undefined, maxChars: number) => {
  if (!value) return '';
  const safeMax = clampInt(maxChars, 1, MAX_FETCH_MAX_CHARS, DEFAULT_FETCH_MAX_CHARS);
  return truncateText(value, safeMax);
};

export const normalizeScores = (scores: string[] | null | undefined): ScoreValue[] => {
  const requested = [...new Set((scores ?? []).map((entry) => entry.trim().toLowerCase()).filter(Boolean))];
  const expanded = requested.flatMap((value) => {
    if (value === 'all') return [...SCORE_VALUES];
    if (value === '4plus') return ['5', '4'] as ScoreValue[];
    if (value === '3plus') return ['5', '4', '3'] as ScoreValue[];
    if (value === 'low') return ['2', '1'] as ScoreValue[];
    return [value];
  });
  const valid = [...new Set(expanded)].filter((value): value is ScoreValue => SCORE_VALUES.includes(value as ScoreValue));
  return valid.length > 0 ? valid : [...SCORE_VALUES];
};

export const normalizeReactions = (reactions: string[] | null | undefined): ReactionValue[] => {
  const requested = [...new Set((reactions ?? []).map((entry) => entry.trim().toLowerCase()).filter(Boolean))];
  const valid = requested.filter((value): value is ReactionValue =>
    REACTION_VALUES.includes(value as ReactionValue)
  );
  return valid.length > 0 ? valid : [...REACTION_VALUES];
};

export type McpArticleCard = {
  id: string;
  canonical_url: string | null;
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
  source_name: string | null;
  source_feed_id: string | null;
  source_reputation: number;
  source_feedback_count: number;
  tags: { id: string; name: string; slug: string }[];
};

type SearchArticlesInput = {
  query?: string;
  limit?: number;
  offset?: number;
  read?: string;
  sort?: string;
  scores?: string[];
  reactions?: string[];
  tags_all?: string[];
};

type SearchInput = {
  query?: string;
  limit?: number;
  offset?: number;
};

type FetchInput = {
  article_id?: string;
  url?: string;
  include_full_text?: boolean;
  max_chars?: number;
};

type GetArticleInput = {
  article_id: string;
  include_full_text?: boolean;
  max_chars?: number;
};

type RetrieveContextBundleInput = {
  question: string;
  max_sources?: number;
  per_source_chars?: number;
};

type SetReadInput = {
  article_id: string;
  is_read: boolean;
};

type SetReactionInput = {
  article_id: string;
  reaction: 'up' | 'down';
};

type SetFitScoreInput = {
  article_id: string;
  score: number;
  comment?: string;
};

type RefreshFeedsInput = {
  cycles?: number;
};

type ContextSource = {
  article_id: string;
  title: string | null;
  canonical_url: string | null;
  published_at: number | null;
  fetched_at: number | null;
  summary_text: string | null;
  content_text: string | null;
  excerpt: string | null;
  score: number | null;
  score_label: string | null;
  source_name: string | null;
  rank: number;
};

type McpContextSource = {
  article_id: string;
  title: string | null;
  url: string | null;
  source_name: string | null;
  published_at: number | null;
  score: number | null;
  score_label: string | null;
  rank: number;
  context_text: string;
  citation: string;
};

const sourceFeedbackToReputation = (ratingSum: number, feedbackCount: number) => {
  if (feedbackCount <= 0) return 0;
  return ratingSum / (feedbackCount + REPUTATION_PRIOR_WEIGHT);
};

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

const compactTags = (tags: { id: string; name: string; slug: string }[] | undefined) =>
  (tags ?? []).map((tag) => ({ id: tag.id, name: tag.name, slug: tag.slug }));

const toSearchSummarySnippet = (article: McpArticleCard) =>
  truncateForMcp(article.summary_text ?? article.excerpt ?? '', 320);

const normalizeContextSources = (
  rows: ContextSource[],
  perSourceChars: number,
  maxSources: number
): McpContextSource[] => {
  const safePerSource = clampInt(perSourceChars, 300, MAX_CONTEXT_SOURCE_CHARS, DEFAULT_CONTEXT_SOURCE_CHARS);
  const safeMaxSources = clampInt(maxSources, 1, MAX_CONTEXT_SOURCES, DEFAULT_CONTEXT_SOURCES);
  return [...rows]
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      const aTime = a.published_at ?? a.fetched_at ?? 0;
      const bTime = b.published_at ?? b.fetched_at ?? 0;
      return bTime - aTime;
    })
    .slice(0, safeMaxSources)
    .map((row) => {
      const contextText = truncateForMcp(row.summary_text ?? row.content_text ?? row.excerpt ?? '', safePerSource);
      const citation = row.canonical_url ? `${row.title ?? 'Untitled'} (${row.canonical_url})` : row.title ?? 'Untitled';
      return {
        article_id: row.article_id,
        title: row.title,
        url: row.canonical_url,
        source_name: row.source_name,
        published_at: row.published_at,
        score: row.score,
        score_label: row.score_label,
        rank: row.rank,
        context_text: contextText,
        citation
      };
    });
};

export const rankAndTruncateContextSources = normalizeContextSources;

const buildArticleSearchWhere = async (db: Db, input: SearchArticlesInput) => {
  const query = input.query?.trim() ?? '';
  const safeQuery = sanitizeQuery(query);
  const selectedScores = normalizeScores(input.scores);
  const selectedReactions = normalizeReactions(input.reactions);
  const readFilter = clampRead(input.read);
  const sort = clampSort(input.sort);
  const limit = clampInt(input.limit, 1, MAX_LIMIT, 20);
  const offset = clampInt(input.offset, 0, MAX_OFFSET, 0);

  const selectedTags = await resolveTagsByTokens(db, input.tags_all ?? []);
  const selectedTagIds = selectedTags.map((tag) => tag.id);

  const whereParts: string[] = [];
  const params: unknown[] = [];

  if (query) {
    whereParts.push('article_search MATCH ?');
    params.push(safeQuery || query);
  }

  if (selectedScores.length < SCORE_VALUES.length) {
    const scoreParts: string[] = [];
    const numericScores = selectedScores.filter((entry) => entry !== 'unscored').map((entry) => Number(entry));
    if (numericScores.length > 0) {
      scoreParts.push(`${effectiveScoreExpr} IN (${placeholders(numericScores.length)})`);
      params.push(...numericScores);
    }
    if (selectedScores.includes('unscored')) {
      scoreParts.push(`${effectiveScoreExpr} IS NULL`);
    }
    if (scoreParts.length > 0) whereParts.push(`(${scoreParts.join(' OR ')})`);
  }

  if (readFilter === 'read') whereParts.push(`${effectiveReadExpr} = 1`);
  if (readFilter === 'unread') whereParts.push(`${effectiveReadExpr} = 0`);

  if (selectedReactions.length < REACTION_VALUES.length) {
    const reactionParts: string[] = [];
    if (selectedReactions.includes('up')) reactionParts.push(`${reactionExpr} = 1`);
    if (selectedReactions.includes('down')) reactionParts.push(`${reactionExpr} = -1`);
    if (selectedReactions.includes('none')) reactionParts.push(`${reactionExpr} IS NULL`);
    if (reactionParts.length > 0) whereParts.push(`(${reactionParts.join(' OR ')})`);
  }

  if (selectedTagIds.length > 0) {
    whereParts.push(
      `(SELECT COUNT(DISTINCT atf.tag_id)
         FROM article_tags atf
        WHERE atf.article_id = a.id
          AND atf.tag_id IN (${placeholders(selectedTagIds.length)})) = ?`
    );
    params.push(...selectedTagIds);
    params.push(selectedTagIds.length);
  }

  const where = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';

  return { query, safeQuery, where, params, selectedTagIds, selectedScores, selectedReactions, readFilter, sort, limit, offset };
};

async function listArticles(db: Db, input: SearchArticlesInput) {
  const clauses = await buildArticleSearchWhere(db, input);
  const join = clauses.query ? 'JOIN article_search ON article_search.article_id = a.id' : '';
  const orderBy = sortOrderClause(clauses.sort);

  const totalRow = await dbGet<{ count: number }>(
    db,
    `SELECT COUNT(*) as count
     FROM articles a
     ${join}
     ${clauses.where}`,
    clauses.params
  );
  const total = Number(totalRow?.count ?? 0);

  const rows = await dbAll<McpArticleCard>(
    db,
    `SELECT
      a.id,
      a.canonical_url,
      a.title,
      a.author,
      a.published_at,
      a.fetched_at,
      a.excerpt,
      a.word_count,
      ${effectiveReadExpr} as is_read,
      (SELECT value FROM article_reactions WHERE article_id = a.id LIMIT 1) as reaction_value,
      (SELECT summary_text FROM article_summaries WHERE article_id = a.id ORDER BY created_at DESC LIMIT 1) as summary_text,
      ${effectiveScoreExpr} as score,
      CASE
        WHEN EXISTS (SELECT 1 FROM article_score_overrides WHERE article_id = a.id) THEN 'User corrected'
        ELSE (SELECT label FROM article_scores WHERE article_id = a.id ORDER BY created_at DESC LIMIT 1)
      END as score_label,
      NULL as source_name,
      NULL as source_feed_id,
      0 as source_reputation,
      0 as source_feedback_count,
      '[]' as tags
    FROM articles a
    ${join}
    ${clauses.where}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?`,
    [...clauses.params, clauses.limit, clauses.offset]
  );

  const articleIds = rows.map((row) => row.id);
  const preferredByArticle = await getPreferredSourcesForArticles(db, articleIds);
  const tagsByArticle = await listTagsForArticles(db, articleIds);

  const articles = rows.map((row) => {
    const preferred = preferredByArticle.get(row.id);
    return {
      ...row,
      source_name: preferred?.sourceName ?? null,
      source_feed_id: preferred?.feedId ?? null,
      source_reputation: preferred?.reputation ?? 0,
      source_feedback_count: preferred?.feedbackCount ?? 0,
      tags: compactTags(tagsByArticle.get(row.id))
    } satisfies McpArticleCard;
  });

  return {
    articles,
    total,
    limit: clauses.limit,
    offset: clauses.offset,
    read: clauses.readFilter,
    sort: clauses.sort,
    scores: clauses.selectedScores,
    reactions: clauses.selectedReactions,
    tags_all: clauses.selectedTagIds
  };
}

async function getArticleScore(db: Db, articleId: string) {
  const scoreOverride = await dbGet<{ score: number; comment: string | null; updated_at: number }>(
    db,
    'SELECT score, comment, updated_at FROM article_score_overrides WHERE article_id = ? LIMIT 1',
    [articleId]
  );

  if (scoreOverride) {
    return {
      score: scoreOverride.score,
      label: 'User corrected',
      reason_text: scoreOverride.comment ?? 'User-set rating override',
      evidence_json: null,
      created_at: scoreOverride.updated_at,
      source: 'user'
    };
  }

  const aiScore = await dbGet<{
    score: number;
    label: string | null;
    reason_text: string | null;
    evidence_json: string | null;
    created_at: number;
  }>(
    db,
    'SELECT score, label, reason_text, evidence_json, created_at FROM article_scores WHERE article_id = ? ORDER BY created_at DESC LIMIT 1',
    [articleId]
  );

  if (!aiScore) return null;
  return { ...aiScore, source: 'ai' };
}

async function getArticleById(db: Db, articleId: string, includeFullText: boolean, maxChars: number) {
  const article = await dbGet<{
    id: string;
    canonical_url: string | null;
    title: string | null;
    author: string | null;
    published_at: number | null;
    fetched_at: number | null;
    content_text: string | null;
    excerpt: string | null;
    word_count: number | null;
    is_read: number;
  }>(
    db,
    `SELECT
      a.id,
      a.canonical_url,
      a.title,
      a.author,
      a.published_at,
      a.fetched_at,
      a.content_text,
      a.excerpt,
      a.word_count,
      COALESCE((SELECT is_read FROM article_read_state WHERE article_id = a.id LIMIT 1), 0) as is_read
    FROM articles a
    WHERE a.id = ?`,
    [articleId]
  );

  if (!article) return null;

  const summary = await dbGet<{
    summary_text: string;
    provider: string;
    model: string;
    created_at: number;
  }>(
    db,
    'SELECT summary_text, provider, model, created_at FROM article_summaries WHERE article_id = ? ORDER BY created_at DESC LIMIT 1',
    [articleId]
  );

  const reaction = await dbGet<{ value: number; feed_id: string; created_at: number }>(
    db,
    'SELECT value, feed_id, created_at FROM article_reactions WHERE article_id = ? LIMIT 1',
    [articleId]
  );

  const score = await getArticleScore(db, articleId);
  const preferredSource = await getPreferredSourceForArticle(db, articleId);
  const sources = await listSourcesForArticle(db, articleId);
  const tags = await listTagsForArticle(db, articleId);

  const fullText = includeFullText
    ? truncateForMcp(article.content_text ?? '', maxChars)
    : truncateForMcp(article.content_text ?? '', Math.min(maxChars, 600));

  return {
    article: {
      ...article,
      content_text: fullText
    },
    summary: summary
      ? {
          ...summary,
          summary_text: truncateForMcp(summary.summary_text, Math.min(maxChars, 4000))
        }
      : null,
    score,
    reaction,
    preferred_source: preferredSource,
    sources,
    tags: compactTags(tags)
  };
}

async function getArticleIdByUrl(db: Db, url: string) {
  const normalized = normalizeUrl(url);
  if (!normalized) return null;
  const row = await dbGet<{ id: string }>(db, 'SELECT id FROM articles WHERE canonical_url = ? LIMIT 1', [normalized]);
  return row?.id ?? null;
}

async function buildContextBundle(db: Db, input: RetrieveContextBundleInput) {
  const question = input.question.trim();
  if (!question) {
    return {
      question,
      sources: [] as McpContextSource[],
      combined_context: '',
      citations: [] as string[]
    };
  }

  const maxSources = clampInt(input.max_sources, 1, MAX_CONTEXT_SOURCES, DEFAULT_CONTEXT_SOURCES);
  const perSourceChars = clampInt(
    input.per_source_chars,
    300,
    MAX_CONTEXT_SOURCE_CHARS,
    DEFAULT_CONTEXT_SOURCE_CHARS
  );
  const safeQuery = sanitizeQuery(question);

  const matches = await dbAll<{ article_id: string; rank: number }>(
    db,
    `SELECT article_id, bm25(article_search) as rank
     FROM article_search
     WHERE article_search MATCH ?
     ORDER BY rank ASC
     LIMIT ?`,
    [safeQuery || question, maxSources * 4]
  );

  if (matches.length === 0) {
    return {
      question,
      sources: [] as McpContextSource[],
      combined_context: '',
      citations: [] as string[]
    };
  }

  const articleIds = [...new Set(matches.map((row) => row.article_id))];
  const rankByArticle = new Map(matches.map((row) => [row.article_id, Number(row.rank ?? 0)]));
  const preferredByArticle = await getPreferredSourcesForArticles(db, articleIds);

  const rows = await dbAll<{
    article_id: string;
    title: string | null;
    canonical_url: string | null;
    published_at: number | null;
    fetched_at: number | null;
    summary_text: string | null;
    content_text: string | null;
    excerpt: string | null;
    score: number | null;
    score_label: string | null;
  }>(
    db,
    `SELECT
      a.id as article_id,
      a.title,
      a.canonical_url,
      a.published_at,
      a.fetched_at,
      (SELECT summary_text FROM article_summaries WHERE article_id = a.id ORDER BY created_at DESC LIMIT 1) as summary_text,
      a.content_text,
      a.excerpt,
      ${effectiveScoreExpr} as score,
      CASE
        WHEN EXISTS (SELECT 1 FROM article_score_overrides WHERE article_id = a.id) THEN 'User corrected'
        ELSE (SELECT label FROM article_scores WHERE article_id = a.id ORDER BY created_at DESC LIMIT 1)
      END as score_label
    FROM articles a
    WHERE a.id IN (${placeholders(articleIds.length)})`,
    articleIds
  );

  const sourceRows: ContextSource[] = rows.map((row) => ({
    ...row,
    source_name: preferredByArticle.get(row.article_id)?.sourceName ?? null,
    rank: rankByArticle.get(row.article_id) ?? Number.MAX_SAFE_INTEGER
  }));

  const sources = normalizeContextSources(sourceRows, perSourceChars, maxSources);
  const citations = sources.map((source) => source.citation);
  const combinedContext = sources
    .map((source, index) => `Source ${index + 1}: ${source.citation}\n${source.context_text}`)
    .join('\n\n');

  return {
    question,
    sources,
    combined_context: combinedContext,
    citations
  };
}

export type McpHandlers = ReturnType<typeof createMcpHandlers>;

export function createMcpHandlers(input: {
  db: Db;
  env: App.Platform['env'];
  context: App.Platform['context'];
}) {
  const { db, env, context } = input;

  return {
    async search(args: SearchInput) {
      const result = await listArticles(db, {
        query: args.query,
        limit: clampInt(args.limit, 1, MAX_LIMIT, 10),
        offset: clampInt(args.offset, 0, MAX_OFFSET, 0),
        read: 'all',
        sort: 'newest',
        scores: [...SCORE_VALUES],
        reactions: [...REACTION_VALUES],
        tags_all: []
      });
      return {
        query: args.query?.trim() ?? '',
        limit: result.limit,
        offset: result.offset,
        total: result.total,
        hits: result.articles.map((article) => ({
          article_id: article.id,
          title: article.title,
          url: article.canonical_url,
          source_name: article.source_name,
          published_at: article.published_at,
          summary_snippet: toSearchSummarySnippet(article),
          score: article.score,
          tags: article.tags.map((tag) => tag.name)
        }))
      };
    },

    async fetch(args: FetchInput) {
      const includeFullText = Boolean(args.include_full_text);
      const maxChars = clampInt(args.max_chars, 1, MAX_FETCH_MAX_CHARS, DEFAULT_FETCH_MAX_CHARS);
      const articleId = args.article_id?.trim() || (args.url ? await getArticleIdByUrl(db, args.url) : null);
      if (!articleId) throw new Error('Article not found');
      const detail = await getArticleById(db, articleId, includeFullText, maxChars);
      if (!detail) throw new Error('Article not found');
      return detail;
    },

    async searchArticles(args: SearchArticlesInput) {
      return listArticles(db, {
        query: args.query,
        limit: args.limit,
        offset: args.offset,
        read: args.read,
        sort: args.sort,
        scores: args.scores,
        reactions: args.reactions,
        tags_all: args.tags_all
      });
    },

    async getArticle(args: GetArticleInput) {
      const includeFullText = Boolean(args.include_full_text);
      const maxChars = clampInt(args.max_chars, 1, MAX_FETCH_MAX_CHARS, DEFAULT_FETCH_MAX_CHARS);
      const detail = await getArticleById(db, args.article_id, includeFullText, maxChars);
      if (!detail) throw new Error('Article not found');
      return detail;
    },

    async retrieveContextBundle(args: RetrieveContextBundleInput) {
      return buildContextBundle(db, args);
    },

    async setArticleRead(args: SetReadInput) {
      await dbRun(
        db,
        `INSERT INTO article_read_state (article_id, is_read, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(article_id) DO UPDATE SET
           is_read = excluded.is_read,
           updated_at = excluded.updated_at`,
        [args.article_id, args.is_read ? 1 : 0, now()]
      );
      return { ok: true, article_id: args.article_id, is_read: Boolean(args.is_read) };
    },

    async setArticleReaction(args: SetReactionInput) {
      const row = await dbGet<{ id: string }>(db, 'SELECT id FROM articles WHERE id = ? LIMIT 1', [args.article_id]);
      if (!row) throw new Error('Article not found');

      const preferredSource = await getPreferredSourceForArticle(db, args.article_id);
      if (!preferredSource?.feedId) {
        throw new Error('No source feed found for article');
      }

      const value = args.reaction === 'down' ? -1 : 1;
      const timestamp = now();
      await dbRun(
        db,
        `INSERT INTO article_reactions (id, article_id, feed_id, value, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(article_id) DO UPDATE SET
           feed_id = excluded.feed_id,
           value = excluded.value,
           created_at = excluded.created_at`,
        [nanoid(), args.article_id, preferredSource.feedId, value, timestamp]
      );

      const reputationRow = await dbGet<{ reaction_count: number; reaction_sum: number }>(
        db,
        'SELECT COUNT(*) as reaction_count, COALESCE(SUM(value), 0) as reaction_sum FROM article_reactions WHERE feed_id = ?',
        [preferredSource.feedId]
      );
      const feedbackCount = Number(reputationRow?.reaction_count ?? 0);
      const ratingSum = Number(reputationRow?.reaction_sum ?? 0);

      return {
        ok: true,
        article_id: args.article_id,
        reaction: args.reaction,
        feed_id: preferredSource.feedId,
        source_reputation: sourceFeedbackToReputation(ratingSum, feedbackCount),
        source_feedback_count: feedbackCount
      };
    },

    async setArticleFitScore(args: SetFitScoreInput) {
      const score = clampInt(args.score, 1, 5, 3);
      const article = await dbGet<{ id: string }>(db, 'SELECT id FROM articles WHERE id = ? LIMIT 1', [args.article_id]);
      if (!article) throw new Error('Article not found');

      const preferredSource = await getPreferredSourceForArticle(db, args.article_id);
      const feedId = preferredSource?.feedId ?? null;
      const comment = args.comment?.trim() || null;
      const timestamp = now();

      await dbRun(
        db,
        'INSERT INTO article_feedback (id, article_id, feed_id, rating, comment, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [nanoid(), args.article_id, feedId, score, comment, timestamp]
      );

      await dbRun(
        db,
        `INSERT INTO article_score_overrides (article_id, score, comment, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(article_id) DO UPDATE SET
           score = excluded.score,
           comment = excluded.comment,
           updated_at = excluded.updated_at`,
        [args.article_id, score, comment, timestamp, timestamp]
      );

      await dbRun(
        db,
        `INSERT INTO jobs (id, type, article_id, status, attempts, run_after, last_error)
         VALUES (?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT(type, article_id) DO UPDATE SET
           status = excluded.status,
           attempts = 0,
           run_after = excluded.run_after,
           last_error = NULL,
           provider = NULL,
           model = NULL`,
        [nanoid(), 'refresh_profile', 'profile', 'pending', 0, now()]
      );

      return {
        ok: true,
        article_id: args.article_id,
        score,
        feed_id: feedId
      };
    },

    async refreshFeeds(args: RefreshFeedsInput) {
      const cycles = clampInt(args.cycles, 1, 3, 1);
      const state = await getManualPullState(db);
      if (state.inProgress) {
        return {
          ok: true,
          started: false,
          cycles,
          reason: 'already_in_progress'
        };
      }

      const runPromise = runManualPull(env, cycles).catch((error) => {
        console.error('[mcp] refresh_feeds failed', error instanceof Error ? error.message : String(error));
      });
      context.waitUntil(runPromise);

      return {
        ok: true,
        started: true,
        cycles
      };
    },

    async getPullStatus() {
      const state = await getManualPullState(db);
      return {
        in_progress: state.inProgress,
        started_at: state.startedAt,
        completed_at: state.completedAt,
        last_run_status: state.lastRunStatus,
        last_error: state.lastError
      };
    }
  };
}

