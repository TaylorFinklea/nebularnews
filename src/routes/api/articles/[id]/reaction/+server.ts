import { nanoid } from 'nanoid';
import {
  areReasonCodesValidForReaction,
  canonicalizeReasonCodesForReaction,
  isReactionValue,
  isValidReactionReasonCode,
  type ArticleReactionReasonCode
} from '$lib/article-reactions';
import { dbGet, dbRun, now } from '$lib/server/db';
import { getPreferredSourceForArticle, isFeedLinkedToArticle } from '$lib/server/sources';
import { apiError, apiOkWithAliases } from '$lib/server/api';
import { logInfo } from '$lib/server/log';
import { replaceReactionReasonCodes } from '$lib/server/reactions';
import { processReactionLearning } from '$lib/server/scoring/learning';

export const POST = async (event) => {
  const { params, request, platform, locals } = event;
  const userId = locals.user?.id ?? 'admin';
  const articleId = params.id;
  const body = (await request.json().catch(() => ({}))) as {
    value?: unknown;
    feedId?: unknown;
    reasonCodes?: unknown;
  };
  const value = Number(body?.value);
  const feedIdInput = typeof body?.feedId === 'string' ? body.feedId.trim() : '';
  const rawReasonCodes = Array.isArray(body?.reasonCodes) ? body.reasonCodes : [];

  if (!isReactionValue(value)) {
    return apiError(event, 400, 'validation_error', 'Invalid reaction value');
  }
  if (!rawReasonCodes.every((code) => typeof code === 'string')) {
    return apiError(event, 400, 'validation_error', 'Invalid reaction reason codes');
  }

  const uniqueReasonCodes = [...new Set(rawReasonCodes)];
  if (uniqueReasonCodes.length > 5) {
    return apiError(event, 400, 'validation_error', 'Too many reaction reason codes');
  }
  if (!uniqueReasonCodes.every((code) => isValidReactionReasonCode(code))) {
    return apiError(event, 400, 'validation_error', 'Invalid reaction reason codes');
  }

  const typedReasonCodes = uniqueReasonCodes as ArticleReactionReasonCode[];
  if (!areReasonCodesValidForReaction(value, typedReasonCodes)) {
    return apiError(event, 400, 'validation_error', 'Reaction reasons do not match the selected reaction');
  }
  const reasonCodes = canonicalizeReasonCodesForReaction(value, typedReasonCodes);

  let feedId: string | null = null;
  if (feedIdInput && (await isFeedLinkedToArticle(locals.db, articleId, feedIdInput))) {
    feedId = feedIdInput;
  } else {
    feedId = (await getPreferredSourceForArticle(locals.db, articleId))?.feedId ?? null;
  }

  if (!feedId) {
    return apiError(event, 400, 'bad_request', 'No source feed found for article');
  }

  const existingReaction = await dbGet<{ value: number | null }>(
    locals.db,
    'SELECT value FROM article_reactions WHERE article_id = ? LIMIT 1',
    [articleId]
  );
  const previousValue = Number(existingReaction?.value);
  const shouldApplyLearning = ![1, -1].includes(previousValue) || previousValue !== value;
  const timestamp = now();
  await dbRun(
    locals.db,
    `INSERT INTO article_reactions (id, article_id, feed_id, value, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(article_id) DO UPDATE SET
       feed_id = excluded.feed_id,
       value = excluded.value,
       created_at = excluded.created_at`,
    [nanoid(), articleId, feedId, value, timestamp]
  );
  await replaceReactionReasonCodes(locals.db, userId, articleId, reasonCodes, timestamp);

  if (shouldApplyLearning) {
    // Update scoring weights and affinities based on reaction changes.
    processReactionLearning(locals.db, articleId, value as 1 | -1, reasonCodes).catch(() => {
      // Learning updates are non-critical — don't block the response
    });
  }

  logInfo('article.reaction.updated', {
    request_id: event.locals.requestId,
    article_id: articleId,
    feed_id: feedId,
    value,
    reason_codes: reasonCodes
  });

  const reaction = {
    article_id: articleId,
    feed_id: feedId,
    value,
    created_at: timestamp,
    reason_codes: reasonCodes
  };

  return apiOkWithAliases(
    event,
    {
      reaction
    },
    {
      reaction: {
        articleId,
        feedId,
        value,
        createdAt: timestamp,
        reasonCodes
      }
    }
  );
};
