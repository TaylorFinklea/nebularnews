import { dbAll, dbGet, type Db } from './db';

const REPUTATION_PRIOR_WEIGHT = 5;

export type FeedReputation = {
  feedbackCount: number;
  ratingSum: number;
  score: number;
};

type SourceCandidateRow = {
  article_id: string;
  feed_id: string;
  published_at: number | null;
  feed_title: string | null;
  site_url: string | null;
  feed_url: string;
};

type FeedReputationRow = {
  feed_id: string;
  feedback_count: number;
  rating_sum: number;
};

export type PreferredSource = {
  feedId: string;
  sourceName: string;
  feedUrl: string;
  feedSiteUrl: string | null;
  reputation: number;
  feedbackCount: number;
};

export type ArticleSource = PreferredSource & {
  publishedAt: number | null;
};

export function computeFeedReputation(ratingSum: number, feedbackCount: number, priorWeight = REPUTATION_PRIOR_WEIGHT) {
  if (feedbackCount <= 0) return 0;
  return (ratingSum - 3 * feedbackCount) / (feedbackCount + priorWeight);
}

const hostnameFromUrl = (value: string | null) => {
  if (!value) return null;
  try {
    const hostname = new URL(value).hostname.replace(/^www\./, '').trim();
    return hostname || null;
  } catch {
    return null;
  }
};

const getSourceName = (candidate: SourceCandidateRow) =>
  candidate.feed_title?.trim() || hostnameFromUrl(candidate.site_url) || hostnameFromUrl(candidate.feed_url) || candidate.feed_url;

export function pickPreferredSource(candidates: SourceCandidateRow[], reputations: Map<string, FeedReputation>) {
  if (candidates.length === 0) return null;
  const sorted = rankCandidates(candidates, reputations);

  const best = sorted[0];
  const rep = reputations.get(best.feed_id);
  return {
    feedId: best.feed_id,
    sourceName: getSourceName(best),
    feedUrl: best.feed_url,
    feedSiteUrl: best.site_url,
    reputation: rep?.score ?? 0,
    feedbackCount: rep?.feedbackCount ?? 0
  } satisfies PreferredSource;
}

const rankCandidates = (candidates: SourceCandidateRow[], reputations: Map<string, FeedReputation>) =>
  [...candidates].sort((a, b) => {
    const repA = reputations.get(a.feed_id)?.score ?? 0;
    const repB = reputations.get(b.feed_id)?.score ?? 0;
    if (repA !== repB) return repB - repA;

    const countA = reputations.get(a.feed_id)?.feedbackCount ?? 0;
    const countB = reputations.get(b.feed_id)?.feedbackCount ?? 0;
    if (countA !== countB) return countB - countA;

    const pubA = a.published_at ?? 0;
    const pubB = b.published_at ?? 0;
    if (pubA !== pubB) return pubB - pubA;

    return a.feed_id.localeCompare(b.feed_id);
  });

const placeholders = (count: number) => new Array(count).fill('?').join(', ');

async function getSourceCandidates(db: Db, articleIds: string[]) {
  if (articleIds.length === 0) return [] as SourceCandidateRow[];
  return dbAll<SourceCandidateRow>(
    db,
    `SELECT
      src.article_id,
      src.feed_id,
      MAX(src.published_at) as published_at,
      f.title as feed_title,
      f.site_url,
      f.url as feed_url
    FROM article_sources src
    JOIN feeds f ON f.id = src.feed_id
    WHERE src.article_id IN (${placeholders(articleIds.length)})
    GROUP BY src.article_id, src.feed_id`,
    articleIds
  );
}

async function getFeedReputations(db: Db, feedIds: string[]) {
  if (feedIds.length === 0) return new Map<string, FeedReputation>();
  const rows = await dbAll<FeedReputationRow>(
    db,
    `SELECT feed_id, COUNT(*) as feedback_count, COALESCE(SUM(rating), 0) as rating_sum
    FROM article_feedback
    WHERE feed_id IN (${placeholders(feedIds.length)})
    GROUP BY feed_id`,
    feedIds
  );

  const reputations = new Map<string, FeedReputation>();
  for (const row of rows) {
    reputations.set(row.feed_id, {
      feedbackCount: row.feedback_count,
      ratingSum: row.rating_sum,
      score: computeFeedReputation(row.rating_sum, row.feedback_count)
    });
  }
  return reputations;
}

export async function getPreferredSourcesForArticles(db: Db, articleIds: string[]) {
  const uniqueArticleIds = [...new Set(articleIds.filter(Boolean))];
  if (uniqueArticleIds.length === 0) return new Map<string, PreferredSource>();

  const sourceCandidates = await getSourceCandidates(db, uniqueArticleIds);
  const feedIds = [...new Set(sourceCandidates.map((candidate) => candidate.feed_id))];
  const reputations = await getFeedReputations(db, feedIds);

  const byArticleId = new Map<string, SourceCandidateRow[]>();
  for (const candidate of sourceCandidates) {
    const existing = byArticleId.get(candidate.article_id) ?? [];
    existing.push(candidate);
    byArticleId.set(candidate.article_id, existing);
  }

  const preferred = new Map<string, PreferredSource>();
  for (const articleId of uniqueArticleIds) {
    const chosen = pickPreferredSource(byArticleId.get(articleId) ?? [], reputations);
    if (chosen) preferred.set(articleId, chosen);
  }

  return preferred;
}

export async function getPreferredSourceForArticle(db: Db, articleId: string) {
  const preferred = await getPreferredSourcesForArticles(db, [articleId]);
  return preferred.get(articleId) ?? null;
}

export async function listSourcesForArticle(db: Db, articleId: string) {
  const candidates = await getSourceCandidates(db, [articleId]);
  const feedIds = [...new Set(candidates.map((candidate) => candidate.feed_id))];
  const reputations = await getFeedReputations(db, feedIds);
  return rankCandidates(candidates, reputations).map((candidate) => {
    const reputation = reputations.get(candidate.feed_id);
    return {
      feedId: candidate.feed_id,
      sourceName: getSourceName(candidate),
      feedUrl: candidate.feed_url,
      feedSiteUrl: candidate.site_url,
      reputation: reputation?.score ?? 0,
      feedbackCount: reputation?.feedbackCount ?? 0,
      publishedAt: candidate.published_at
    } satisfies ArticleSource;
  });
}

export async function isFeedLinkedToArticle(db: Db, articleId: string, feedId: string) {
  const linked = await dbGet<{ feed_id: string }>(
    db,
    'SELECT feed_id FROM article_sources WHERE article_id = ? AND feed_id = ? LIMIT 1',
    [articleId, feedId]
  );
  return Boolean(linked);
}
