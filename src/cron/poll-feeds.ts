import { nanoid } from 'nanoid';
import type { Env } from '../env';
import { dbAll, dbGet, dbRun } from '../db/helpers';
import { parseFeed } from '../lib/feed-parser';

type Feed = {
  id: string;
  url: string;
  etag: string | null;
  last_modified: string | null;
  error_count: number;
};

const FIVE_MINUTES_MS = 5 * 60 * 1000;

export async function pollFeeds(env: Env): Promise<void> {
  const db = env.DB;
  const now = Date.now();
  const maxFeeds = parseInt(env.MAX_FEEDS_PER_POLL) || 12;
  const maxItemsPerPoll = parseInt(env.MAX_ITEMS_PER_POLL) || 100;
  const itemsPerFeed = Math.floor(maxItemsPerPoll / maxFeeds);

  const feeds = await dbAll<Feed>(
    db,
    `SELECT id, url, etag, last_modified, error_count
     FROM feeds
     WHERE disabled = 0 AND (next_poll_at IS NULL OR next_poll_at <= ?)
     ORDER BY next_poll_at ASC
     LIMIT ?`,
    [now, maxFeeds],
  );

  let totalNew = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  for (const feed of feeds) {
    try {
      const headers: Record<string, string> = {
        'User-Agent': 'NebularNews/2.0 (+rss)',
      };
      if (feed.etag) headers['If-None-Match'] = feed.etag;
      if (feed.last_modified) headers['If-Modified-Since'] = feed.last_modified;

      const res = await fetch(feed.url, { headers });

      if (res.status === 304) {
        // Not modified — just bump next_poll_at
        await dbRun(db,
          `UPDATE feeds SET next_poll_at = ? WHERE id = ?`,
          [now + FIVE_MINUTES_MS, feed.id],
        );
        totalSkipped++;
        continue;
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const xml = await res.text();
      const parsed = parseFeed(xml);

      const newEtag = res.headers.get('etag');
      const newLastModified = res.headers.get('last-modified');

      let newArticles = 0;
      const items = parsed.items.slice(0, itemsPerFeed);

      for (const item of items) {
        const canonicalUrl = item.url;
        if (!canonicalUrl) continue;

        const existing = await dbGet<{ id: string }>(
          db,
          `SELECT id FROM articles WHERE canonical_url = ?`,
          [canonicalUrl],
        );

        if (!existing) {
          const articleId = nanoid();
          await dbRun(db,
            `INSERT INTO articles (id, title, canonical_url, author, content_html, content_text, image_url, published_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              articleId,
              item.title,
              canonicalUrl,
              item.author,
              item.contentHtml,
              item.contentText,
              item.imageUrl,
              item.publishedAt,
              now,
              now,
            ],
          );
          await dbRun(db,
            `INSERT OR IGNORE INTO article_sources (id, article_id, feed_id, guid, published_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [nanoid(), articleId, feed.id, item.guid, item.publishedAt, now],
          );
          newArticles++;
        } else {
          // Article exists — link source if not already linked
          await dbRun(db,
            `INSERT OR IGNORE INTO article_sources (id, article_id, feed_id, guid, published_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [nanoid(), existing.id, feed.id, item.guid, item.publishedAt, now],
          );
        }
      }

      totalNew += newArticles;

      // Update feed metadata on success
      await dbRun(db,
        `UPDATE feeds SET last_polled_at = ?, next_poll_at = ?, etag = ?, last_modified = ?, error_count = 0
         WHERE id = ?`,
        [now, now + FIVE_MINUTES_MS, newEtag, newLastModified, feed.id],
      );
    } catch (err) {
      totalErrors++;
      const newErrorCount = (feed.error_count || 0) + 1;
      // Exponential backoff: 5min * 2^error_count, capped at 24h
      const backoffMs = Math.min(
        FIVE_MINUTES_MS * Math.pow(2, newErrorCount),
        24 * 60 * 60 * 1000,
      );
      await dbRun(db,
        `UPDATE feeds SET error_count = ?, next_poll_at = ? WHERE id = ?`,
        [newErrorCount, now + backoffMs, feed.id],
      );
    }
  }

  // Record pull_run stats
  const statsJson = JSON.stringify({ feeds_polled: feeds.length, articles_new: totalNew, articles_skipped: totalSkipped, errors: totalErrors });
  await dbRun(db,
    `INSERT INTO pull_runs (id, status, trigger, started_at, completed_at, stats_json, created_at, updated_at)
     VALUES (?, 'done', 'cron', ?, ?, ?, ?, ?)`,
    [nanoid(), now, Date.now(), statsJson, now, now],
  );
}
