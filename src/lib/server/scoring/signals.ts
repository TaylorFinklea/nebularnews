import { dbAll, dbGet, type Db } from '../db';
import { getFeedReputations } from '../sources';
import type { SignalResult } from './types';

type ArticleForScoring = {
  id: string;
  title: string | null;
  author: string | null;
  content_text: string | null;
  published_at: number | null;
  source_feed_id: string | null;
};

/** Sigmoid normalization centered at 0 */
const sigmoid = (x: number, steepness = 2): number => 1 / (1 + Math.exp(-steepness * x));

/** Exponential decay — half-life in the given unit */
const exponentialDecay = (elapsed: number, halfLife: number): number =>
  Math.exp((-elapsed * Math.LN2) / halfLife);

/** Logistic ramp from 0 to 1 between min and max */
const logisticRamp = (value: number, min: number, max: number): number => {
  if (value <= min) return 0;
  if (value >= max) return 1;
  return (value - min) / (max - min);
};

// ─── Individual signal extractors ────────────────────────────────────

async function extractTopicAffinity(db: Db, articleId: string): Promise<SignalResult> {
  const tags = await dbAll<{ name_normalized: string }>(
    db,
    `SELECT t.name_normalized
     FROM article_tags at
     JOIN tags t ON at.tag_id = t.id
     WHERE at.article_id = ?`,
    [articleId]
  );

  if (tags.length === 0) {
    return { signal: 'topic_affinity', rawValue: 0, normalizedValue: 0.5, isDataBacked: false };
  }

  const placeholders = tags.map(() => '?').join(',');
  const affinities = await dbAll<{ affinity: number }>(
    db,
    `SELECT affinity FROM topic_affinities WHERE tag_name_normalized IN (${placeholders})`,
    tags.map((t) => t.name_normalized)
  );

  if (affinities.length === 0) {
    return { signal: 'topic_affinity', rawValue: 0, normalizedValue: 0.5, isDataBacked: false };
  }

  const avgAffinity = affinities.reduce((sum, a) => sum + a.affinity, 0) / affinities.length;
  return {
    signal: 'topic_affinity',
    rawValue: avgAffinity,
    normalizedValue: sigmoid(avgAffinity, 2),
    isDataBacked: true
  };
}

async function extractSourceReputation(db: Db, feedId: string | null): Promise<SignalResult> {
  if (!feedId) {
    return { signal: 'source_reputation', rawValue: 0, normalizedValue: 0.5, isDataBacked: false };
  }

  const reputations = await getFeedReputations(db, [feedId]);
  const reputation = reputations.get(feedId);

  if (!reputation || reputation.feedbackCount === 0) {
    return { signal: 'source_reputation', rawValue: 0, normalizedValue: 0.5, isDataBacked: false };
  }

  const normalized = Math.max(0, Math.min(1, (reputation.score + 1) / 2));
  return {
    signal: 'source_reputation',
    rawValue: reputation.score,
    normalizedValue: normalized,
    isDataBacked: true
  };
}

function extractContentFreshness(publishedAt: number | null): SignalResult {
  if (!publishedAt) {
    return { signal: 'content_freshness', rawValue: 0, normalizedValue: 0.5, isDataBacked: false };
  }

  const ageHours = (Date.now() - publishedAt) / (1000 * 60 * 60);
  const HALF_LIFE_HOURS = 168; // 1 week
  const freshness = exponentialDecay(Math.max(0, ageHours), HALF_LIFE_HOURS);

  return {
    signal: 'content_freshness',
    rawValue: ageHours,
    normalizedValue: freshness,
    isDataBacked: true
  };
}

function extractContentDepth(contentText: string | null): SignalResult {
  if (!contentText) {
    return { signal: 'content_depth', rawValue: 0, normalizedValue: 0, isDataBacked: false };
  }

  const wordCount = contentText.split(/\s+/).filter(Boolean).length;
  const MIN_WORDS = 200;
  const MAX_WORDS = 2000;
  const normalized = logisticRamp(wordCount, MIN_WORDS, MAX_WORDS);

  return {
    signal: 'content_depth',
    rawValue: wordCount,
    normalizedValue: normalized,
    isDataBacked: true
  };
}

async function extractAuthorAffinity(db: Db, author: string | null): Promise<SignalResult> {
  if (!author || !author.trim()) {
    return { signal: 'author_affinity', rawValue: 0, normalizedValue: 0.5, isDataBacked: false };
  }

  const normalized = author.trim().toLowerCase();
  const row = await dbGet<{ affinity: number }>(
    db,
    'SELECT affinity FROM author_affinities WHERE author_normalized = ?',
    [normalized]
  );

  if (!row) {
    return { signal: 'author_affinity', rawValue: 0, normalizedValue: 0.5, isDataBacked: false };
  }

  return {
    signal: 'author_affinity',
    rawValue: row.affinity,
    normalizedValue: sigmoid(row.affinity, 2),
    isDataBacked: true
  };
}

async function extractTagMatchRatio(db: Db, articleId: string): Promise<SignalResult> {
  const tags = await dbAll<{ name_normalized: string }>(
    db,
    `SELECT t.name_normalized
     FROM article_tags at
     JOIN tags t ON at.tag_id = t.id
     WHERE at.article_id = ?`,
    [articleId]
  );

  if (tags.length === 0) {
    return { signal: 'tag_match_ratio', rawValue: 0, normalizedValue: 0, isDataBacked: false };
  }

  const placeholders = tags.map(() => '?').join(',');
  const affinityRows = await dbAll<{ tag_name_normalized: string; affinity: number }>(
    db,
    `SELECT tag_name_normalized, affinity
     FROM topic_affinities
     WHERE tag_name_normalized IN (${placeholders})`,
    tags.map((t) => t.name_normalized)
  );

  if (affinityRows.length === 0) {
    return { signal: 'tag_match_ratio', rawValue: 0, normalizedValue: 0.5, isDataBacked: false };
  }

  const affinityByTag = new Map(affinityRows.map((row) => [row.tag_name_normalized, row.affinity]));
  let signedMatchSum = 0;
  let knownAffinityCount = 0;

  for (const tag of tags) {
    const affinity = affinityByTag.get(tag.name_normalized);
    if (typeof affinity !== 'number' || affinity === 0) {
      continue;
    }
    knownAffinityCount++;
    signedMatchSum += affinity > 0 ? 1 : -1;
  }

  if (knownAffinityCount === 0) {
    return { signal: 'tag_match_ratio', rawValue: 0, normalizedValue: 0.5, isDataBacked: false };
  }

  const ratio = signedMatchSum / tags.length;

  return {
    signal: 'tag_match_ratio',
    rawValue: ratio,
    normalizedValue: Math.max(0, Math.min(1, (ratio + 1) / 2)),
    isDataBacked: true
  };
}

// ─── Main extraction orchestrator ────────────────────────────────────

export async function extractSignals(db: Db, article: ArticleForScoring): Promise<SignalResult[]> {
  const [topicAffinity, sourceReputation, authorAffinity, tagMatchRatio] = await Promise.all([
    extractTopicAffinity(db, article.id),
    extractSourceReputation(db, article.source_feed_id),
    extractAuthorAffinity(db, article.author),
    extractTagMatchRatio(db, article.id)
  ]);

  const contentFreshness = extractContentFreshness(article.published_at);
  const contentDepth = extractContentDepth(article.content_text);

  return [topicAffinity, sourceReputation, contentFreshness, contentDepth, authorAffinity, tagMatchRatio];
}

export { type ArticleForScoring };
