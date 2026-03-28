import { dbAll, dbGet, type Db } from '../db';
import {
  attachTagToArticle,
  detachTagFromArticle,
  listTagLinksForArticle,
  serializeArticleTagLinkState
} from '../tags';
import { DETERMINISTIC_TAG_KEYWORDS_BY_SLUG } from './taxonomy';

const TITLE_PHRASE_WEIGHT = 1.0;
const URL_PHRASE_WEIGHT = 0.4;
const CONTENT_PHRASE_WEIGHT = 0.35;
const TITLE_TOKEN_WEIGHT = 0.3;
const TITLE_TOKEN_CAP = 0.6;
const CONTENT_TOKEN_WEIGHT = 0.08;
const CONTENT_TOKEN_CAP = 0.4;
const FEED_PRIOR_BONUS = 0.25;
const FEED_PRIOR_MIN_ARTICLES = 3;
const FEED_PRIOR_MIN_RATIO = 0.2;

export const DEFAULT_DETERMINISTIC_TAG_ATTACH_THRESHOLD = 0.65;
export const DEFAULT_DETERMINISTIC_MAX_SYSTEM_TAGS = 3;

type CanonicalTagCandidate = {
  id: string;
  name: string;
  name_normalized: string;
  slug: string;
  article_count: number;
};

type FeedPrior = {
  taggedArticleCount: number;
  ratio: number;
};

export type DeterministicTaggingContext = {
  title: string | null;
  canonicalUrl: string | null;
  contentText: string | null;
  feedTitle?: string | null;
  siteHostname?: string | null;
};

export type DeterministicTagCandidate = {
  id: string;
  name: string;
  normalizedName: string;
  slug: string;
  articleCount?: number;
};

export type DeterministicTagDecision = {
  tagId: string;
  score: number;
  confidence: number;
  features: string[];
};

export type AppliedDeterministicTags = {
  changed: boolean;
  beforeState: string;
  afterState: string;
  attachedTagIds: string[];
  updatedTagIds: string[];
  removedTagIds: string[];
  skippedExistingTagIds: string[];
};

const normalizeWhitespace = (value: string) => value.trim().replace(/\s+/g, ' ');

const normalizeText = (value: string | null | undefined) =>
  ` ${String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()} `;

const tokenize = (value: string | null | undefined) =>
  [...new Set(normalizeText(value).trim().split(/\s+/).filter((token) => token.length >= 3))];

const hasPhrase = (haystack: string, needle: string) => {
  if (!needle) return false;
  return haystack.includes(` ${needle} `);
};

const overlapCount = (candidateTokens: readonly string[], haystackTokens: ReadonlySet<string>) =>
  candidateTokens.reduce((count, token) => count + (haystackTokens.has(token) ? 1 : 0), 0);

export const scoreDeterministicTagCandidate = (
  candidate: DeterministicTagCandidate,
  context: DeterministicTaggingContext,
  feedPrior?: FeedPrior | null
): DeterministicTagDecision => {
  const normalizedName = normalizeWhitespace(candidate.normalizedName).toLowerCase();
  const keywordPhrases = [...new Set((DETERMINISTIC_TAG_KEYWORDS_BY_SLUG[candidate.slug] ?? []).map((value) => normalizeWhitespace(value).toLowerCase()))];
  const candidatePhrases = [...new Set([normalizedName, ...keywordPhrases])];
  const titleText = normalizeText(`${context.title ?? ''} ${context.feedTitle ?? ''}`);
  const contentText = normalizeText(String(context.contentText ?? '').slice(0, 12000));
  const url = context.canonicalUrl ?? '';
  let normalizedUrlText = normalizeText(context.siteHostname ?? '');
  try {
    const parsed = new URL(url);
    normalizedUrlText = normalizeText(
      `${context.siteHostname ?? ''} ${parsed.hostname.replace(/^www\./, '')} ${parsed.pathname}`
    );
  } catch {
    normalizedUrlText = normalizeText(`${context.siteHostname ?? ''} ${url}`);
  }

  const candidateTokens = [...new Set(candidatePhrases.flatMap((value) => tokenize(value)))];
  const titleTokens = new Set(tokenize(context.title));
  const feedTitleTokens = new Set(tokenize(context.feedTitle));
  const titleLikeTokens = new Set([...titleTokens, ...feedTitleTokens]);
  const contentTokens = new Set(tokenize(String(context.contentText ?? '').slice(0, 12000)));

  let score = 0;
  const features: string[] = [];

  if (candidatePhrases.some((phrase) => hasPhrase(titleText, phrase))) {
    score += TITLE_PHRASE_WEIGHT;
    features.push('title_phrase');
  }

  if (
    candidatePhrases.some((phrase) => hasPhrase(normalizedUrlText, phrase)) ||
    (candidate.slug && String(url).toLowerCase().includes(candidate.slug))
  ) {
    score += URL_PHRASE_WEIGHT;
    features.push('url_phrase');
  }

  if (candidatePhrases.some((phrase) => hasPhrase(contentText, phrase))) {
    score += CONTENT_PHRASE_WEIGHT;
    features.push('content_phrase');
  }

  const titleOverlap = overlapCount(candidateTokens, titleLikeTokens);
  if (titleOverlap > 0) {
    score += Math.min(TITLE_TOKEN_CAP, titleOverlap * TITLE_TOKEN_WEIGHT);
    features.push(`title_overlap:${titleOverlap}`);
  }

  const contentOverlap = overlapCount(candidateTokens, contentTokens);
  if (contentOverlap > 0) {
    score += Math.min(CONTENT_TOKEN_CAP, contentOverlap * CONTENT_TOKEN_WEIGHT);
    features.push(`content_overlap:${contentOverlap}`);
  }

  if (
    feedPrior &&
    feedPrior.taggedArticleCount >= FEED_PRIOR_MIN_ARTICLES &&
    feedPrior.ratio >= FEED_PRIOR_MIN_RATIO
  ) {
    score += FEED_PRIOR_BONUS;
    features.push('feed_prior');
  }

  return {
    tagId: candidate.id,
    score: Number(score.toFixed(4)),
    confidence: Number(Math.min(1, score).toFixed(4)),
    features
  };
};

const listCanonicalTagCandidates = async (db: Db): Promise<CanonicalTagCandidate[]> =>
  dbAll<CanonicalTagCandidate>(
    db,
    `SELECT
      t.id,
      t.name,
      t.name_normalized,
      t.slug,
      COUNT(at.article_id) AS article_count
     FROM tags t
     LEFT JOIN article_tags at ON at.tag_id = t.id
     GROUP BY t.id
     ORDER BY article_count DESC, t.updated_at DESC, LOWER(t.name) ASC`
  );

const getFeedPriors = async (db: Db, articleId: string, feedId: string | null) => {
  if (!feedId) {
    return {
      totalTaggedArticles: 0,
      byTagId: new Map<string, number>()
    };
  }

  const totalRow = await dbGet<{ count: number }>(
    db,
    `SELECT COUNT(DISTINCT at.article_id) AS count
     FROM article_tags at
     JOIN article_sources src ON src.article_id = at.article_id
     WHERE src.feed_id = ?
       AND at.source IN ('manual', 'system')
       AND at.article_id != ?`,
    [feedId, articleId]
  );
  const rows = await dbAll<{ tag_id: string; article_count: number }>(
    db,
    `SELECT at.tag_id, COUNT(DISTINCT at.article_id) AS article_count
     FROM article_tags at
     JOIN article_sources src ON src.article_id = at.article_id
     WHERE src.feed_id = ?
       AND at.source IN ('manual', 'system')
       AND at.article_id != ?
     GROUP BY at.tag_id`,
    [feedId, articleId]
  );

  return {
    totalTaggedArticles: Number(totalRow?.count ?? 0),
    byTagId: new Map(rows.map((row) => [row.tag_id, Number(row.article_count ?? 0)]))
  };
};

export const generateDeterministicTagDecisions = async (
  db: Db,
  input: {
    articleId: string;
    title: string | null;
    canonicalUrl: string | null;
    contentText: string | null;
    sourceFeedId: string | null;
    sourceFeedTitle?: string | null;
    sourceSiteHostname?: string | null;
    attachThreshold?: number;
    maxTags?: number;
  }
): Promise<DeterministicTagDecision[]> => {
  const [candidates, priors] = await Promise.all([
    listCanonicalTagCandidates(db),
    getFeedPriors(db, input.articleId, input.sourceFeedId)
  ]);

  const context: DeterministicTaggingContext = {
    title: input.title,
    canonicalUrl: input.canonicalUrl,
    contentText: input.contentText,
    feedTitle: input.sourceFeedTitle ?? null,
    siteHostname: input.sourceSiteHostname ?? null
  };
  const threshold = Number.isFinite(input.attachThreshold)
    ? Math.max(0, Number(input.attachThreshold))
    : DEFAULT_DETERMINISTIC_TAG_ATTACH_THRESHOLD;
  const maxTags = Number.isFinite(input.maxTags)
    ? Math.max(1, Math.floor(Number(input.maxTags)))
    : DEFAULT_DETERMINISTIC_MAX_SYSTEM_TAGS;

  return candidates
    .map((candidate) =>
      scoreDeterministicTagCandidate(
        {
          id: candidate.id,
          name: candidate.name,
          normalizedName: candidate.name_normalized,
          slug: candidate.slug,
          articleCount: Number(candidate.article_count ?? 0)
        },
        context,
        priors.totalTaggedArticles > 0 && priors.byTagId.has(candidate.id)
          ? {
              taggedArticleCount: Number(priors.byTagId.get(candidate.id) ?? 0),
              ratio: Number(priors.byTagId.get(candidate.id) ?? 0) / priors.totalTaggedArticles
            }
          : null
      )
    )
    .filter((decision) => decision.score >= threshold)
    .sort((a, b) => b.score - a.score || b.confidence - a.confidence || a.tagId.localeCompare(b.tagId))
    .slice(0, maxTags);
};

export const applyDeterministicTagDecisions = async (
  db: Db,
  articleId: string,
  decisions: DeterministicTagDecision[]
): Promise<AppliedDeterministicTags> => {
  const existingLinks = await listTagLinksForArticle(db, articleId);
  const currentSystemLinks = existingLinks.filter((link) => link.source === 'system');
  const currentState = serializeArticleTagLinkState(currentSystemLinks);
  const existingByTagId = new Map(existingLinks.map((link) => [link.tagId, link]));
  const desiredByTagId = new Map(decisions.map((decision) => [decision.tagId, decision]));

  const attachedTagIds: string[] = [];
  const updatedTagIds: string[] = [];
  const removedTagIds: string[] = [];
  const skippedExistingTagIds: string[] = [];

  for (const link of currentSystemLinks) {
    if (!desiredByTagId.has(link.tagId)) {
      await detachTagFromArticle(db, articleId, link.tagId);
      removedTagIds.push(link.tagId);
    }
  }

  for (const decision of decisions) {
    const existing = existingByTagId.get(decision.tagId);
    if (!existing) {
      await attachTagToArticle(db, {
        articleId,
        tagId: decision.tagId,
        source: 'system',
        confidence: decision.confidence
      });
      attachedTagIds.push(decision.tagId);
      continue;
    }

    if (existing.source !== 'system') {
      skippedExistingTagIds.push(decision.tagId);
      continue;
    }

    if (existing.confidence !== decision.confidence) {
      await attachTagToArticle(db, {
        articleId,
        tagId: decision.tagId,
        source: 'system',
        confidence: decision.confidence
      });
      updatedTagIds.push(decision.tagId);
    }
  }

  const nextSystemLinks = await listTagLinksForArticle(db, articleId, { sources: ['system'] });
  const nextState = serializeArticleTagLinkState(nextSystemLinks);

  return {
    changed: currentState !== nextState,
    beforeState: currentState,
    afterState: nextState,
    attachedTagIds,
    updatedTagIds,
    removedTagIds,
    skippedExistingTagIds
  };
};
