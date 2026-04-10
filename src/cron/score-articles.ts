import { nanoid } from 'nanoid';
import type { Env } from '../env';
import { dbAll, dbGet, dbRun } from '../db/helpers';

type UserRow = { user_id: string };
type WeightRow = { signal_name: string; weight: number };
type ArticleRow = {
  id: string;
  title: string | null;
  content_text: string | null;
  published_at: number | null;
  word_count: number | null;
  feed_id: string | null;
};
type TagRow = { name_normalized: string };
type ReactionRow = { feed_id: string; reaction: string };

const DEFAULT_WEIGHTS: Record<string, number> = {
  source_reputation: 0.8,
  content_freshness: 0.6,
  content_depth: 0.5,
  tag_match_ratio: 0.9,
};

// ---------------------------------------------------------------------------
// Signal computation helpers
// ---------------------------------------------------------------------------

function computeFreshness(publishedAt: number | null): number {
  if (!publishedAt) return 0.5;
  const ageHours = (Date.now() - publishedAt) / (1000 * 60 * 60);
  const HALF_LIFE = 168; // 1 week in hours
  return Math.exp((-ageHours * Math.LN2) / HALF_LIFE);
}

function computeDepth(contentText: string | null, wordCount: number | null): number {
  const wc = wordCount ?? (contentText ? contentText.split(/\s+/).filter(Boolean).length : 0);
  if (wc <= 200) return 0;
  if (wc >= 2000) return 1;
  return (wc - 200) / (2000 - 200);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function scoreArticles(env: Env): Promise<void> {
  const db = env.DB;
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

  // Get all users with subscriptions
  const users = await dbAll<UserRow>(
    db,
    `SELECT DISTINCT user_id FROM user_feed_subscriptions`,
    [],
  );

  for (const { user_id } of users) {
    try {
      // Load user's signal weights (merge with defaults)
      const weightRows = await dbAll<WeightRow>(
        db,
        `SELECT signal_name, weight FROM signal_weights WHERE user_id = ?`,
        [user_id],
      );
      const weights: Record<string, number> = { ...DEFAULT_WEIGHTS };
      for (const row of weightRows) {
        weights[row.signal_name] = row.weight;
      }

      // Get unscored articles from subscribed feeds, last 7 days
      const articles = await dbAll<ArticleRow>(
        db,
        `SELECT a.id, a.title, a.content_text, a.published_at, a.word_count,
                asrc.feed_id
         FROM articles a
         JOIN article_sources asrc ON asrc.article_id = a.id
         JOIN user_feed_subscriptions ufs ON ufs.feed_id = asrc.feed_id AND ufs.user_id = ?
         WHERE a.published_at >= ?
           AND ufs.paused = 0
           AND NOT EXISTS (
             SELECT 1 FROM article_scores sc
             WHERE sc.article_id = a.id AND sc.user_id = ? AND sc.method = 'algorithmic'
           )
         GROUP BY a.id
         LIMIT 200`,
        [user_id, sevenDaysAgo, user_id],
      );

      if (articles.length === 0) continue;

      // Pre-load user's reaction history for source_reputation
      const reactions = await dbAll<ReactionRow>(
        db,
        `SELECT asrc.feed_id, r.reaction
         FROM reactions r
         JOIN article_sources asrc ON asrc.article_id = r.article_id
         WHERE r.user_id = ?`,
        [user_id],
      );

      // Compute per-feed reputation from reactions
      const feedStats = new Map<string, { up: number; down: number }>();
      for (const r of reactions) {
        if (!feedStats.has(r.feed_id)) feedStats.set(r.feed_id, { up: 0, down: 0 });
        const stats = feedStats.get(r.feed_id)!;
        if (r.reaction === 'upvote' || r.reaction === 'save') stats.up++;
        else if (r.reaction === 'downvote' || r.reaction === 'hide') stats.down++;
      }

      // Pre-load user's upvoted article tags for tag_match_ratio
      const userTags = await dbAll<TagRow>(
        db,
        `SELECT DISTINCT t.name_normalized
         FROM reactions r
         JOIN article_tags at ON at.article_id = r.article_id
         JOIN tags t ON t.id = at.tag_id
         WHERE r.user_id = ? AND r.reaction IN ('upvote', 'save')`,
        [user_id],
      );
      const userTagSet = new Set(userTags.map((t) => t.name_normalized));

      // Score each article
      for (const article of articles) {
        // 1. source_reputation
        let sourceRep = 0.5;
        if (article.feed_id && feedStats.has(article.feed_id)) {
          const stats = feedStats.get(article.feed_id)!;
          const total = stats.up + stats.down;
          if (total > 0) {
            sourceRep = stats.up / total;
          }
        }

        // 2. content_freshness
        const freshness = computeFreshness(article.published_at);

        // 3. content_depth
        const depth = computeDepth(article.content_text, article.word_count);

        // 4. tag_match_ratio
        let tagMatch = 0.5;
        if (userTagSet.size > 0) {
          const articleTags = await dbAll<TagRow>(
            db,
            `SELECT t.name_normalized
             FROM article_tags at
             JOIN tags t ON t.id = at.tag_id
             WHERE at.article_id = ?`,
            [article.id],
          );
          if (articleTags.length > 0) {
            const matchCount = articleTags.filter((t) => userTagSet.has(t.name_normalized)).length;
            tagMatch = matchCount / articleTags.length;
          }
        }

        // Weighted average
        const signals = { source_reputation: sourceRep, content_freshness: freshness, content_depth: depth, tag_match_ratio: tagMatch };
        let weightedSum = 0;
        let totalWeight = 0;
        for (const [name, value] of Object.entries(signals)) {
          const w = weights[name] ?? 1.0;
          weightedSum += w * value;
          totalWeight += w;
        }

        const average = totalWeight > 0 ? weightedSum / totalWeight : 0.5;
        // Map 0-1 to 1-5
        const score = Math.max(1, Math.min(5, Math.round(1 + 4 * average)));

        await dbRun(db,
          `INSERT INTO article_scores (id, article_id, user_id, score, method, created_at)
           VALUES (?, ?, ?, ?, 'algorithmic', ?)`,
          [nanoid(), article.id, user_id, score, now],
        );
      }
    } catch (err) {
      // Log and continue to next user
      console.error(`[score-articles] Error scoring for user ${user_id}:`, err);
    }
  }
}
