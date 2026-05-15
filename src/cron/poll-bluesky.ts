import { nanoid } from 'nanoid';
import type { Env } from '../env';
import { dbAll, dbGet, dbRun } from '../db/helpers';
import { authorFeedUrl, parseAuthorFeed } from '../lib/bluesky';

// Cron sibling to pollFeeds / pollReddit. Polls subscribed Bluesky author
// feeds via the public unauthenticated ATProto endpoint. Anonymous reads are
// rate-limited; back off on errors using the same exponential pattern.

const FIVE_MINUTES_MS = 5 * 60 * 1000;

interface BlueskyFeed {
  id: string;
  url: string;            // canonical stored as 'https://bsky.app/profile/<handle>'
  error_count: number;
}

function handleFromStoredUrl(storedUrl: string): string | null {
  const m = storedUrl.match(/^https?:\/\/bsky\.app\/profile\/([a-z0-9.-]+)\/?$/i);
  return m ? m[1].toLowerCase() : null;
}

export async function pollBluesky(env: Env): Promise<void> {
  const db = env.DB;
  const now = Date.now();
  const maxFeeds = parseInt(env.MAX_FEEDS_PER_POLL) || 8;
  const maxItemsPerFeed = 30;

  const feeds = await dbAll<BlueskyFeed>(
    db,
    `SELECT id, url, error_count
       FROM feeds
      WHERE disabled = 0
        AND source_type = 'bluesky'
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
      const handle = handleFromStoredUrl(feed.url);
      if (!handle) throw new Error(`Invalid stored Bluesky URL: ${feed.url}`);

      const res = await fetch(authorFeedUrl(handle, maxItemsPerFeed), {
        headers: {
          'User-Agent': 'NebularNews/1.0 (MCP server; +https://nebularnews.com)',
          'Accept': 'application/json',
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const json = await res.json();
      const posts = parseAuthorFeed(json);

      for (const post of posts) {
        const existing = await dbGet<{ id: string }>(
          db,
          `SELECT id FROM articles WHERE source_type = 'bluesky' AND canonical_url = ?`,
          [post.canonicalUrl],
        );
        if (existing) {
          // Refresh engagement counters; cheap.
          await dbRun(
            db,
            `UPDATE articles SET source_data_json = ? WHERE id = ?`,
            [JSON.stringify(post.raw), existing.id],
          );
          continue;
        }

        const articleId = nanoid();
        const excerpt = post.text.slice(0, 300);
        const wordCount = post.text.split(/\s+/).filter(Boolean).length;

        await dbRun(
          db,
          `INSERT INTO articles
             (id, title, canonical_url, guid, author,
              content_text, excerpt, word_count, image_url,
              published_at, fetched_at, source_type, source_data_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'bluesky', ?)`,
          [
            articleId,
            // Bluesky posts have no titles; use a truncated text or a placeholder.
            post.text.length > 0 ? post.text.slice(0, 120) : '(no text)',
            post.canonicalUrl,
            post.uri,
            `@${post.authorHandle}`,
            post.text,
            excerpt,
            wordCount,
            post.imageUrl,
            post.publishedAt,
            now,
            JSON.stringify({ ...post.raw, isReply: post.isReply, handle: post.authorHandle }),
          ],
        );

        await dbRun(
          db,
          `INSERT OR IGNORE INTO article_sources (id, article_id, feed_id, item_guid, published_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [nanoid(), articleId, feed.id, post.uri, post.publishedAt, now],
        );

        totalNew++;
      }

      await dbRun(
        db,
        `UPDATE feeds SET last_polled_at = ?, next_poll_at = ?, error_count = 0,
                          title = COALESCE(title, ?)
         WHERE id = ?`,
        [now, now + FIVE_MINUTES_MS, `@${handle}`, feed.id],
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[poll-bluesky] Error polling ${feed.url}:`, errMsg);
      totalErrors++;
      const newErrorCount = (feed.error_count || 0) + 1;
      const backoffMs = Math.min(
        FIVE_MINUTES_MS * Math.pow(2, newErrorCount),
        24 * 60 * 60 * 1000,
      );
      await dbRun(
        db,
        `UPDATE feeds SET error_count = ?, next_poll_at = ?, last_scrape_error = ?
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
      JSON.stringify({ source: 'bluesky', feeds_polled: feeds.length, articles_new: totalNew, errors: totalErrors }),
      now,
      now,
    ],
  );
}
