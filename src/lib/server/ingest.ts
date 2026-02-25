import { nanoid } from 'nanoid';
import { dbAll, dbBatch, dbGet, dbRun, now, type Db } from './db';
import { fetchAndParseFeed, type FeedItem } from './feeds';
import { extractMainContent, computeWordCount } from './text';
import { normalizeUrl } from './urls';
import { extractLeadImageUrlFromHtml, normalizeImageUrl } from './images';
import {
  getAutoTaggingEnabled,
  clampInitialFeedLookbackDays,
  getInitialFeedLookbackDays,
  getMaxFeedsPerPoll,
  getMaxItemsPerPoll
} from './settings';

const textEncoder = new TextEncoder();

const sha256 = async (text: string) => {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

const POLL_INTERVAL_MS = 1000 * 60 * 60;
const MAX_PUBLISHED_FUTURE_MS = 1000 * 60 * 60 * 24;
const DAY_MS = 1000 * 60 * 60 * 24;
const MAX_FEEDS_PER_POLL = 12;
const MAX_ITEMS_PER_FEED_PER_POLL = 15;
const MAX_ITEMS_PER_POLL = 120;
const ARTICLE_FETCH_TIMEOUT_MS = 10_000;
const IMAGE_BACKFILL_COOLDOWN_MS = 1000 * 60 * 60 * 6;

const utcDayStart = (timestamp: number) => {
  const day = new Date(timestamp);
  return Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
};

export function normalizePublishedAt(publishedAt: number | null | undefined, fallbackAt: number) {
  if (!publishedAt || !Number.isFinite(publishedAt)) return null;
  if (publishedAt > fallbackAt + MAX_PUBLISHED_FUTURE_MS) {
    return fallbackAt;
  }
  return publishedAt;
}

export function shouldAutoQueueArticleJobs(
  publishedAt: number | null | undefined,
  fetchedAt: number,
  referenceAt = fetchedAt
) {
  const candidateAt = typeof publishedAt === 'number' && Number.isFinite(publishedAt) ? publishedAt : fetchedAt;
  const dayStart = utcDayStart(referenceAt);
  const dayEnd = dayStart + DAY_MS;
  return candidateAt >= dayStart && candidateAt < dayEnd;
}

export type FeedPollError = {
  feedId: string;
  url: string;
  message: string;
};

export type FeedPollSummary = {
  dueFeeds: number;
  feedsPolled: number;
  feedsSkippedDueToBudget: number;
  itemBudgetRemaining: number;
  itemsSeen: number;
  itemsProcessed: number;
  errors: FeedPollError[];
};

type PollFeedsOptions = {
  onFeedSettled?: (feedId: string) => Promise<void> | void;
  maxFeeds?: number;
  maxItemsPerFeed?: number;
  maxItemsTotal?: number;
  initialFeedLookbackDays?: number;
};

export function shouldIngestItemForInitialLookback(
  publishedAt: number | null | undefined,
  referenceAt: number,
  lookbackDays: number
) {
  if (!publishedAt || !Number.isFinite(publishedAt)) return true;
  const days = Math.max(0, Math.floor(lookbackDays));
  if (days <= 0) return true;
  const cutoff = referenceAt - days * DAY_MS;
  return publishedAt >= cutoff;
}

export async function pollFeeds(
  env: App.Platform['env'],
  options: PollFeedsOptions = {}
): Promise<FeedPollSummary> {
  const db = env.DB;
  const pollStartedAt = now();
  const configuredMaxFeeds = await getMaxFeedsPerPoll(db, env);
  const configuredMaxItemsTotal = await getMaxItemsPerPoll(db, env);
  const maxFeeds = Math.max(1, Math.min(100, Math.floor(options.maxFeeds ?? configuredMaxFeeds ?? MAX_FEEDS_PER_POLL)));
  const maxItemsPerFeed = Math.max(1, Math.min(100, Math.floor(options.maxItemsPerFeed ?? MAX_ITEMS_PER_FEED_PER_POLL)));
  const maxItemsTotal = Math.max(
    1,
    Math.min(2000, Math.floor(options.maxItemsTotal ?? configuredMaxItemsTotal ?? MAX_ITEMS_PER_POLL))
  );
  const initialFeedLookbackDays = clampInitialFeedLookbackDays(
    options.initialFeedLookbackDays ?? (await getInitialFeedLookbackDays(db))
  );
  const autoTaggingEnabled = await getAutoTaggingEnabled(db);
  const dueFeeds = await dbAll<{
    id: string;
    url: string;
    etag: string | null;
    last_modified: string | null;
    last_polled_at: number | null;
  }>(
    db,
    'SELECT id, url, etag, last_modified, last_polled_at FROM feeds WHERE disabled = 0 AND (next_poll_at IS NULL OR next_poll_at <= ?) ORDER BY next_poll_at ASC LIMIT ?',
    [pollStartedAt, maxFeeds]
  );
  const summary: FeedPollSummary = {
    dueFeeds: dueFeeds.length,
    feedsPolled: 0,
    feedsSkippedDueToBudget: 0,
    itemBudgetRemaining: 0,
    itemsSeen: 0,
    itemsProcessed: 0,
    errors: []
  };
  let remainingItemsBudget = maxItemsTotal;

  for (const feed of dueFeeds) {
    if (remainingItemsBudget <= 0) break;
    summary.feedsPolled += 1;
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
      const initialPoll = !feed.last_polled_at;
      const boundedItems = initialPoll
        ? parsed.items.filter((item) =>
            shouldIngestItemForInitialLookback(item.publishedAt, pollStartedAt, initialFeedLookbackDays)
          )
        : parsed.items;
      const itemsForFeed = boundedItems.slice(0, Math.min(maxItemsPerFeed, remainingItemsBudget));
      summary.itemsSeen += itemsForFeed.length;
      remainingItemsBudget -= itemsForFeed.length;
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

      for (const item of itemsForFeed) {
        if (await ingestFeedItem(db, feed.id, item, { autoTaggingEnabled })) {
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
    } finally {
      await options.onFeedSettled?.(feed.id);
    }
  }

  summary.feedsSkippedDueToBudget = Math.max(0, summary.dueFeeds - summary.feedsPolled);
  summary.itemBudgetRemaining = Math.max(0, remainingItemsBudget);

  return summary;
}

const resolveImageBackfillRunAfter = (imageCheckedAt: number | null | undefined, referenceAt: number) => {
  const checkedAt = Number(imageCheckedAt ?? 0);
  if (!Number.isFinite(checkedAt) || checkedAt <= 0) return referenceAt;
  return Math.max(referenceAt, checkedAt + IMAGE_BACKFILL_COOLDOWN_MS);
};

async function queueImageBackfillJob(
  db: Db,
  articleId: string,
  options: { imageCheckedAt?: number | null; referenceAt: number }
) {
  const runAfter = resolveImageBackfillRunAfter(options.imageCheckedAt, options.referenceAt);
  const timestamp = options.referenceAt;

  await dbRun(
    db,
    `INSERT INTO jobs (id, type, article_id, status, attempts, priority, run_after, last_error, provider, model, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(type, article_id) DO UPDATE SET
       status = CASE WHEN jobs.status = 'running' THEN jobs.status ELSE excluded.status END,
       attempts = CASE WHEN jobs.status = 'running' THEN jobs.attempts ELSE 0 END,
       priority = excluded.priority,
       run_after = CASE
         WHEN jobs.status = 'running' THEN jobs.run_after
         WHEN jobs.run_after IS NULL THEN excluded.run_after
         ELSE MIN(jobs.run_after, excluded.run_after)
       END,
       last_error = CASE WHEN jobs.status = 'running' THEN jobs.last_error ELSE NULL END,
       provider = NULL,
       model = NULL,
       locked_by = CASE WHEN jobs.status = 'running' THEN jobs.locked_by ELSE NULL END,
       locked_at = CASE WHEN jobs.status = 'running' THEN jobs.locked_at ELSE NULL END,
       lease_expires_at = CASE WHEN jobs.status = 'running' THEN jobs.lease_expires_at ELSE NULL END,
       updated_at = excluded.updated_at`,
    [nanoid(), 'image_backfill', articleId, 'pending', 0, 120, runAfter, null, null, null, timestamp, timestamp]
  );
}

async function ingestFeedItem(
  db: Db,
  feedId: string,
  item: FeedItem,
  options: { autoTaggingEnabled: boolean }
): Promise<boolean> {
  const url = normalizeUrl(item.url ?? null);
  if (!url) return false;
  const guid = item.guid ?? url;
  const fetchedAt = now();
  const normalizedPublishedAt = normalizePublishedAt(item.publishedAt, fetchedAt);

  let contentHtml = item.contentHtml ?? null;
  let contentText = item.contentText ?? null;
  let imageUrl = normalizeImageUrl(item.imageUrl, url);
  const shouldFetchFullArticle = shouldAutoQueueArticleJobs(normalizedPublishedAt, fetchedAt);

  if (!imageUrl && contentHtml) {
    imageUrl = extractLeadImageUrlFromHtml(contentHtml, url);
  }

  // Keep ingestion bounded: only do expensive full-page fetch for current-day content.
  if (shouldFetchFullArticle && (!contentText || contentText.length < 200 || !imageUrl)) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ARTICLE_FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': 'NebularNews/0.1 (+article)' },
        signal: controller.signal
      });
      if (res.ok) {
        const html = await res.text();
        const extracted = extractMainContent(html, url);
        contentHtml = extracted.contentHtml;
        contentText = extracted.contentText;
        if (!imageUrl) {
          imageUrl = extractLeadImageUrlFromHtml(html, url);
        }
      }
    } catch {
      // ignore fetch failures
    } finally {
      clearTimeout(timeout);
    }
  }

  const safeText = contentText ?? item.title ?? url;
  const contentHash = await sha256(safeText);

  const existing = await dbGet<{
    id: string;
    image_url: string | null;
    image_checked_at: number | null;
  }>(
    db,
    'SELECT id, image_url, image_checked_at FROM articles WHERE canonical_url = ? OR content_hash = ? LIMIT 1',
    [url, contentHash]
  );

  let articleId = existing?.id ?? nanoid();

  if (!existing) {
    const excerpt = safeText.slice(0, 280);
    const wordCount = computeWordCount(contentText ?? '');

    const result = await dbRun(
      db,
      `INSERT OR IGNORE INTO articles (
         id, canonical_url, guid, title, author, published_at, fetched_at,
         content_html, content_text, excerpt, word_count, content_hash,
         image_url, image_status, image_checked_at, status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        imageUrl,
        imageUrl ? 'found' : 'pending',
        imageUrl ? fetchedAt : null,
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

      if (shouldAutoQueueArticleJobs(normalizedPublishedAt, fetchedAt)) {
        const queuedAt = now();
        const jobs = [
          {
            sql: 'INSERT OR IGNORE INTO jobs (id, type, article_id, status, attempts, priority, run_after, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            params: [nanoid(), 'summarize', articleId, 'pending', 0, 100, queuedAt, queuedAt, queuedAt]
          },
          {
            sql: 'INSERT OR IGNORE INTO jobs (id, type, article_id, status, attempts, priority, run_after, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            params: [nanoid(), 'score', articleId, 'pending', 0, 100, queuedAt, queuedAt, queuedAt]
          }
        ];
        if (options.autoTaggingEnabled) {
          jobs.push({
            sql: 'INSERT OR IGNORE INTO jobs (id, type, article_id, status, attempts, priority, run_after, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            params: [nanoid(), 'auto_tag', articleId, 'pending', 0, 100, queuedAt, queuedAt, queuedAt]
          });
        }
        await dbBatch(db, jobs);
      }
    }
  } else if (imageUrl) {
    await dbRun(
      db,
      `UPDATE articles
       SET image_url = COALESCE(image_url, ?),
           image_status = 'found',
           image_checked_at = ?
       WHERE id = ?`,
      [imageUrl, fetchedAt, articleId]
    );
  }

  const knownImageUrl = imageUrl ?? existing?.image_url ?? null;
  if (!knownImageUrl && url) {
    await queueImageBackfillJob(db, articleId, {
      imageCheckedAt: existing?.image_checked_at ?? null,
      referenceAt: fetchedAt
    });
  }

  await dbRun(
    db,
    'INSERT OR IGNORE INTO article_sources (id, article_id, feed_id, item_guid, original_url, published_at) VALUES (?, ?, ?, ?, ?, ?)',
    [nanoid(), articleId, feedId, guid, url, normalizedPublishedAt]
  );

  return true;
}
