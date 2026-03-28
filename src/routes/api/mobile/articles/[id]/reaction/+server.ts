import { json } from '@sveltejs/kit';
import { nanoid } from 'nanoid';
import {
  areReasonCodesValidForReaction,
  canonicalizeReasonCodesForReaction,
  isReactionValue,
  isValidReactionReasonCode,
  type ArticleReactionReasonCode
} from '$lib/article-reactions';
import { dbGet, dbRun, now } from '$lib/server/db';
import { requireMobileAccess } from '$lib/server/mobile/auth';
import { replaceReactionReasonCodes } from '$lib/server/reactions';
import { getPreferredSourceForArticle, isFeedLinkedToArticle } from '$lib/server/sources';
import { processReactionLearning } from '$lib/server/scoring/learning';

export const POST = async ({ params, request, platform, locals }) => {
  const { user } = await requireMobileAccess(request, platform.env, locals.db, 'app:write');

  const articleId = params.id;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const value = Number(body?.value);
  const feedIdRaw = body?.feedId ?? body?.feed_id;
  const feedIdInput = typeof feedIdRaw === 'string' ? feedIdRaw.trim() : '';
  const reasonCodesRaw = body?.reasonCodes ?? body?.reason_codes;
  const rawReasonCodes = Array.isArray(reasonCodesRaw) ? reasonCodesRaw : [];

  if (!isReactionValue(value)) {
    return json({ error: 'Invalid reaction value' }, { status: 400 });
  }
  if (!rawReasonCodes.every((code) => typeof code === 'string')) {
    return json({ error: 'Invalid reaction reason codes' }, { status: 400 });
  }

  const uniqueReasonCodes = [...new Set(rawReasonCodes)];
  if (uniqueReasonCodes.length > 5) {
    return json({ error: 'Too many reaction reason codes' }, { status: 400 });
  }
  if (!uniqueReasonCodes.every((code) => isValidReactionReasonCode(code))) {
    return json({ error: 'Invalid reaction reason codes' }, { status: 400 });
  }

  const typedReasonCodes = uniqueReasonCodes as ArticleReactionReasonCode[];
  if (!areReasonCodesValidForReaction(value, typedReasonCodes)) {
    return json({ error: 'Reaction reasons do not match the selected reaction' }, { status: 400 });
  }
  const reasonCodes = canonicalizeReasonCodesForReaction(value, typedReasonCodes);

  let feedId: string | null = null;
  if (feedIdInput && (await isFeedLinkedToArticle(locals.db, articleId, feedIdInput))) {
    feedId = feedIdInput;
  } else {
    feedId = (await getPreferredSourceForArticle(locals.db, articleId))?.feedId ?? null;
  }

  if (!feedId) {
    return json({ error: 'No source feed found for article' }, { status: 400 });
  }

  const existingReaction = await dbGet<{ value: number | null }>(
    locals.db,
    'SELECT value FROM article_reactions WHERE article_id = ? AND user_id = ? LIMIT 1',
    [articleId, user.id]
  );
  const previousValue = Number(existingReaction?.value);
  const shouldApplyLearning = ![1, -1].includes(previousValue) || previousValue !== value;
  const timestamp = now();

  await dbRun(
    locals.db,
    `INSERT INTO article_reactions (id, user_id, article_id, feed_id, value, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, article_id) DO UPDATE SET
       feed_id = excluded.feed_id,
       value = excluded.value,
       created_at = excluded.created_at`,
    [nanoid(), user.id, articleId, feedId, value, timestamp]
  );
  await replaceReactionReasonCodes(locals.db, user.id, articleId, reasonCodes, timestamp);

  if (shouldApplyLearning) {
    processReactionLearning(locals.db, articleId, value as 1 | -1, reasonCodes).catch(() => {});
  }

  return json({
    reaction: {
      article_id: articleId,
      feed_id: feedId,
      value,
      created_at: timestamp,
      reason_codes: reasonCodes
    }
  });
};
