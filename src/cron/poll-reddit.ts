import { nanoid } from 'nanoid';
import type { Env } from '../env';
import { dbAll, dbGet, dbRun } from '../db/helpers';
import { canonicalizeUrl } from '../lib/canonical-url';

// Cron sibling to pollFeeds. Polls subscribed subreddits via the public
// /r/<sub>/.json endpoint — no OAuth required for read-only listings, but
// Reddit aggressively rate-limits unauthenticated traffic, so we cap the
// per-tick fetch and throttle on errors. If/when we exceed the unauth
// budget, this function is the obvious place to wire OAuth via the
// `script` app type (RFC 7591-style client_credentials).

const FIVE_MINUTES_MS = 5 * 60 * 1000;

interface RedditFeed {
  id: string;
  url: string;             // canonical e.g. 'r/birding'
  error_count: number;
  scrape_mode: string;
  feed_type: string | null;
}

interface RedditChild {
  kind: string;
  data: {
    id: string;
    name: string;          // 't3_<id>'
    title: string;
    author: string;
    subreddit: string;
    permalink: string;
    url: string;
    selftext: string;
    score: number;
    num_comments: number;
    created_utc: number;
    is_self: boolean;
    stickied: boolean;
    over_18: boolean;
    thumbnail: string;
  };
}

export async function pollReddit(env: Env): Promise<void> {
  const db = env.DB;
  const now = Date.now();
  const maxFeeds = parseInt(env.MAX_FEEDS_PER_POLL) || 8;
  const maxItemsPerSub = 25;

  const feeds = await dbAll<RedditFeed>(
    db,
    `SELECT id, url, error_count, scrape_mode, feed_type
       FROM feeds
      WHERE disabled = 0
        AND source_type = 'reddit'
        AND (next_poll_at IS NULL OR next_poll_at <= ?)
      ORDER BY next_poll_at ASC
      LIMIT ?`,
    [now, maxFeeds],
  );

  if (feeds.length === 0) return;

  let totalNew = 0;
  let totalErrors = 0;

  for (const feed of feeds) {
    try {
      const sub = feed.url.startsWith('r/') ? feed.url.slice(2) : feed.url;
      const fetchUrl = `https://www.reddit.com/r/${sub}/.json?limit=${maxItemsPerSub}`;

      const res = await fetch(fetchUrl, {
        headers: {
          'User-Agent': 'NebularNews/1.0 (MCP server; +https://nebularnews.com)',
          'Accept': 'application/json',
        },
      });

      if (!res.ok) {
        // Reddit returns 403 for blocked subs and 429 when throttled.
        throw new Error(`HTTP ${res.status}`);
      }

      const json = await res.json() as { data?: { children?: RedditChild[] } };
      const children = json.data?.children ?? [];

      for (const child of children) {
        if (child.kind !== 't3') continue;
        const post = child.data;
        if (post.stickied) continue;          // skip pinned mod posts
        if (post.over_18) continue;           // NSFW filter — opt-in flag for later

        const canonicalUrl = `https://www.reddit.com${post.permalink}`;
        const existing = await dbGet<{ id: string }>(
          db,
          `SELECT id FROM articles WHERE source_type = 'reddit' AND canonical_url = ?`,
          [canonicalUrl],
        );

        if (existing) {
          // Update score/comment count on existing rows so the LLM sees fresh
          // engagement when ranking. Cheap, no scrape.
          await dbRun(
            db,
            `UPDATE articles SET source_data_json = ? WHERE id = ?`,
            [
              JSON.stringify({
                score: post.score,
                num_comments: post.num_comments,
                subreddit: post.subreddit,
                author: post.author,
                is_self: post.is_self,
                external_url: post.is_self ? null : post.url,
              }),
              existing.id,
            ],
          );
          continue;
        }

        const articleId = nanoid();
        const publishedAt = post.created_utc * 1000;
        const contentText = post.is_self ? post.selftext : '';
        const wordCount = contentText.split(/\s+/).filter(Boolean).length;
        const excerpt = (post.is_self ? post.selftext : `Link: ${post.url}`).slice(0, 300);
        const imageUrl = post.thumbnail && /^https?:\/\//.test(post.thumbnail) ? post.thumbnail : null;

        await dbRun(
          db,
          `INSERT INTO articles
             (id, title, canonical_url, guid, author,
              content_text, excerpt, word_count, image_url,
              published_at, fetched_at, source_type, source_data_json,
              canonical_url_normalized)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'reddit', ?, ?)`,
          [
            articleId,
            post.title,
            canonicalUrl,
            post.name,
            `u/${post.author}`,
            contentText,
            excerpt,
            wordCount,
            imageUrl,
            publishedAt,
            now,
            JSON.stringify({
              score: post.score,
              num_comments: post.num_comments,
              subreddit: post.subreddit,
              author: post.author,
              is_self: post.is_self,
              external_url: post.is_self ? null : post.url,
            }),
            canonicalizeUrl(canonicalUrl),
          ],
        );

        await dbRun(
          db,
          `INSERT OR IGNORE INTO article_sources (id, article_id, feed_id, item_guid, published_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [nanoid(), articleId, feed.id, post.name, publishedAt, now],
        );

        totalNew++;
      }

      await dbRun(
        db,
        `UPDATE feeds SET last_polled_at = ?, next_poll_at = ?, error_count = 0,
                          title = COALESCE(title, ?)
         WHERE id = ?`,
        [now, now + FIVE_MINUTES_MS, `r/${sub}`, feed.id],
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[poll-reddit] Error polling ${feed.url}:`, errMsg);
      totalErrors++;
      const newErrorCount = (feed.error_count || 0) + 1;
      // Reddit gets aggressive — back off harder than RSS does. 5min × 2^n
      // capped at 24h.
      const backoffMs = Math.min(
        FIVE_MINUTES_MS * Math.pow(2, newErrorCount),
        24 * 60 * 60 * 1000,
      );
      await dbRun(
        db,
        `UPDATE feeds SET error_count = ?, next_poll_at = ?,
                          last_scrape_error = ?
         WHERE id = ?`,
        [newErrorCount, now + backoffMs, errMsg.slice(0, 500), feed.id],
      );
    }
  }

  await dbRun(
    db,
    `INSERT INTO pull_runs (id, status, trigger, started_at, completed_at, stats_json, created_at, updated_at)
     VALUES (?, 'done', 'cron', ?, ?, ?, ?, ?)`,
    [
      nanoid(),
      now,
      Date.now(),
      JSON.stringify({ source: 'reddit', subs_polled: feeds.length, articles_new: totalNew, errors: totalErrors }),
      now,
      now,
    ],
  );
}
