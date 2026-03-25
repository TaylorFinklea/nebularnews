import type { ArticleReactionReasonCode, ReactionValue } from '$lib/article-reactions';
import { ALL_REACTION_REASON_CODES } from '$lib/article-reactions';
import { dbAll, dbGet, dbRun, type Db } from './db';

const REASON_ORDER_SQL = `CASE reason_code
${ALL_REACTION_REASON_CODES.map((code, index) => `  WHEN '${code}' THEN ${index}`).join('\n')}
  ELSE ${ALL_REACTION_REASON_CODES.length}
END`;

export type ArticleReactionRecord = {
  value: ReactionValue;
  feed_id: string;
  created_at: number;
  reason_codes: ArticleReactionReasonCode[];
};

export async function listReactionReasonCodesForArticle(
  db: Db,
  userId: string,
  articleId: string
): Promise<ArticleReactionReasonCode[]> {
  const rows = await dbAll<{ reason_code: ArticleReactionReasonCode }>(
    db,
    `SELECT reason_code
     FROM article_reaction_reasons
     WHERE article_id = ? AND user_id = ?
     ORDER BY ${REASON_ORDER_SQL}`,
    [articleId, userId]
  );

  return rows.map((row) => row.reason_code);
}

export async function listReactionReasonCodesForArticles(
  db: Db,
  userId: string,
  articleIds: readonly string[]
): Promise<Map<string, ArticleReactionReasonCode[]>> {
  const uniqueArticleIds = [...new Set(articleIds.filter(Boolean))];
  if (uniqueArticleIds.length === 0) {
    return new Map();
  }

  const placeholders = uniqueArticleIds.map(() => '?').join(', ');
  const rows = await dbAll<{ article_id: string; reason_code: ArticleReactionReasonCode }>(
    db,
    `SELECT article_id, reason_code
     FROM article_reaction_reasons
     WHERE article_id IN (${placeholders}) AND user_id = ?
     ORDER BY article_id, ${REASON_ORDER_SQL}`,
    [...uniqueArticleIds, userId]
  );

  const reasonsByArticle = new Map<string, ArticleReactionReasonCode[]>();
  for (const articleId of uniqueArticleIds) {
    reasonsByArticle.set(articleId, []);
  }

  for (const row of rows) {
    const existing = reasonsByArticle.get(row.article_id) ?? [];
    existing.push(row.reason_code);
    reasonsByArticle.set(row.article_id, existing);
  }

  return reasonsByArticle;
}

export async function getReactionForArticle(
  db: Db,
  userId: string,
  articleId: string
): Promise<ArticleReactionRecord | null> {
  const reaction = await dbGet<{ value: number; feed_id: string; created_at: number }>(
    db,
    'SELECT value, feed_id, created_at FROM article_reactions WHERE article_id = ? AND user_id = ? LIMIT 1',
    [articleId, userId]
  );

  if (!reaction || (reaction.value !== 1 && reaction.value !== -1)) {
    return null;
  }

  const reason_codes = await listReactionReasonCodesForArticle(db, userId, articleId);
  return {
    value: reaction.value,
    feed_id: reaction.feed_id,
    created_at: reaction.created_at,
    reason_codes
  };
}

export async function replaceReactionReasonCodes(
  db: Db,
  userId: string,
  articleId: string,
  reasonCodes: readonly ArticleReactionReasonCode[],
  createdAt: number
) {
  await dbRun(db, 'DELETE FROM article_reaction_reasons WHERE article_id = ? AND user_id = ?', [articleId, userId]);
  for (const reasonCode of reasonCodes) {
    await dbRun(
      db,
      `INSERT INTO article_reaction_reasons (article_id, user_id, reason_code, created_at)
       VALUES (?, ?, ?, ?)`,
      [articleId, userId, reasonCode, createdAt]
    );
  }
}
