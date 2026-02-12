import { nanoid } from 'nanoid';
import { dbAll, dbBatch, dbGet, dbRun, now, type Db } from './db';
import { fetchAndParseFeed, type FeedItem } from './feeds';
import { extractMainContent, computeWordCount } from './text';
import { normalizeUrl } from './urls';

const textEncoder = new TextEncoder();

const sha256 = async (text: string) => {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

const POLL_INTERVAL_MS = 1000 * 60 * 60;
const MAX_PUBLISHED_FUTURE_MS = 1000 * 60 * 60 * 24;

export function normalizePublishedAt(publishedAt: number | null | undefined, fallbackAt: number) {
  if (!publishedAt || !Number.isFinite(publishedAt)) return null;
  if (publishedAt > fallbackAt + MAX_PUBLISHED_FUTURE_MS) {
    return fallbackAt;
  }
  return publishedAt;
}

export type FeedPollError = {
  feedId: string;
  url: string;
  message: string;
};

export type FeedPollSummary = {
  dueFeeds: number;
  itemsSeen: number;
  itemsProcessed: number;
  errors: FeedPollError[];
};

export async function pollFeeds(env: App.Platform['env']): Promise<FeedPollSummary> {
  const db = env.DB;
  const dueFeeds = await dbAll<{
    id: string;
    url: string;
    etag: string | null;
    last_modified: string | null;
  }>(
    db,
    'SELECT id, url, etag, last_modified FROM feeds WHERE disabled = 0 AND (next_poll_at IS NULL OR next_poll_at <= ?) ORDER BY next_poll_at ASC LIMIT 25',
    [now()]
  );
  const summary: FeedPollSummary = {
    dueFeeds: dueFeeds.length,
    itemsSeen: 0,
    itemsProcessed: 0,
    errors: []
  };

  for (const feed of dueFeeds) {
    try {
      const result = await fetchAndParseFeed(feed.url, feed.etag, feed.last_modified);
      const nextPoll = now() + POLL_INTERVAL_MS;

      if (result.notModified) {
        await dbRun(db, 'UPDATE feeds SET last_polled_at = ?, next_poll_at = ?, error_count = 0 WHERE id = ?', [
          now(),
          nextPoll,
          feed.id
        ]);
        continue;
      }

      const parsed = result.feed;
      summary.itemsSeen += parsed.items.length;
      await dbRun(
        db,
        'UPDATE feeds SET title = ?, site_url = ?, etag = ?, last_modified = ?, last_polled_at = ?, next_poll_at = ?, error_count = 0 WHERE id = ?',
        [
          parsed.title,
          parsed.siteUrl,
          result.etag ?? feed.etag,
          result.lastModified ?? feed.last_modified,
          now(),
          nextPoll,
          feed.id
        ]
      );

      for (const item of parsed.items) {
        if (await ingestFeedItem(db, feed.id, item)) {
          summary.itemsProcessed += 1;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      summary.errors.push({
        feedId: feed.id,
        url: feed.url,
        message
      });
      const nextPoll = now() + POLL_INTERVAL_MS;
      await dbRun(db, 'UPDATE feeds SET error_count = error_count + 1, next_poll_at = ? WHERE id = ?', [
        nextPoll,
        feed.id
      ]);
    }
  }

  return summary;
}

async function ingestFeedItem(db: Db, feedId: string, item: FeedItem): Promise<boolean> {
  const url = normalizeUrl(item.url ?? null);
  if (!url) return false;
  const guid = item.guid ?? url;
  const fetchedAt = now();
  const normalizedPublishedAt = normalizePublishedAt(item.publishedAt, fetchedAt);

  let contentHtml = item.contentHtml ?? null;
  let contentText = item.contentText ?? null;

  if (!contentText || contentText.length < 200) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'NebularNews/0.1 (+article)' } });
      if (res.ok) {
        const html = await res.text();
        const extracted = extractMainContent(html, url);
        contentHtml = extracted.contentHtml;
        contentText = extracted.contentText;
      }
    } catch {
      // ignore fetch failures
    }
  }

  const safeText = contentText ?? item.title ?? url;
  const contentHash = await sha256(safeText);

  const existing = await dbGet<{ id: string }>(
    db,
    'SELECT id FROM articles WHERE canonical_url = ? OR content_hash = ? LIMIT 1',
    [url, contentHash]
  );

  let articleId = existing?.id ?? nanoid();

  if (!existing) {
    const excerpt = safeText.slice(0, 280);
    const wordCount = computeWordCount(contentText ?? '');

    const result = await dbRun(
      db,
      'INSERT OR IGNORE INTO articles (id, canonical_url, guid, title, author, published_at, fetched_at, content_html, content_text, excerpt, word_count, content_hash, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        articleId,
        url,
        guid,
        item.title,
        item.author,
        normalizedPublishedAt,
        fetchedAt,
        contentHtml,
        contentText,
        excerpt,
        wordCount,
        contentHash,
        'ingested'
      ]
    );

    if (!result.changes) {
      const dup = await dbGet<{ id: string }>(db, 'SELECT id FROM articles WHERE canonical_url = ? OR content_hash = ?', [
        url,
        contentHash
      ]);
      if (dup) articleId = dup.id;
    } else {
      await dbRun(
        db,
        'INSERT INTO article_search (article_id, title, content_text, summary_text) VALUES (?, ?, ?, ?)',
        [articleId, item.title, contentText ?? '', '']
      );

      const jobs = [
        {
          sql: 'INSERT OR IGNORE INTO jobs (id, type, article_id, status, attempts, run_after) VALUES (?, ?, ?, ?, ?, ?)',
          params: [nanoid(), 'summarize', articleId, 'pending', 0, now()]
        },
        {
          sql: 'INSERT OR IGNORE INTO jobs (id, type, article_id, status, attempts, run_after) VALUES (?, ?, ?, ?, ?, ?)',
          params: [nanoid(), 'score', articleId, 'pending', 0, now()]
        }
      ];
      await dbBatch(db, jobs);
    }
  }

  await dbRun(
    db,
    'INSERT OR IGNORE INTO article_sources (id, article_id, feed_id, item_guid, original_url, published_at) VALUES (?, ?, ?, ?, ?, ?)',
    [nanoid(), articleId, feedId, guid, url, normalizedPublishedAt]
  );

  return true;
}
