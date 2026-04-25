import type { Env } from '../env';
import { dbAll, dbRun } from '../db/helpers';
import { scrapeAndPersist, type ScrapeProvider } from '../lib/scraper';

const MIN_CONTENT_WORDS = 50;
// Below this extraction_quality, treat the result as a failure even if
// wordCount cleared the minimum. Steel/Browserless will sometimes return a
// paywall stub or "subscribe to read" teaser that has technically enough
// words but no real article. Tuning point — watch the cron logs and adjust.
const MIN_EXTRACTION_QUALITY = 0.25;
const MAX_RETRIES = 5;
const BATCH_SIZE = 50;

/**
 * Pick the OTHER provider for the next retry. If the prior attempt used
 * Steel and produced a low-quality result, try Browserless next, and vice
 * versa. Returns null when we don't know what was used last (e.g. the
 * extraction_method is one of the structured-failure markers from chunk 2,
 * or this is the first retry), in which case the feed's default preference
 * holds.
 *
 * Exported for unit tests.
 */
export function escalatedProvider(lastMethod: string | null): ScrapeProvider | null {
  if (lastMethod === 'steel') return 'browserless';
  if (lastMethod === 'browserless') return 'steel';
  return null;
}

// Exponential backoff for retry attempts. `nextAttempt` is 1-based, so the
// first failure waits 15m, the second 30m, the third 1h, the fourth 2h, the
// fifth 4h. Capped at 24h for defensive safety (cap never triggers at the
// current max-5 budget but keeps the function resilient to future tuning).
//
// Exported for unit tests.
export function backoffMs(nextAttempt: number): number {
  const minutes = 15 * Math.pow(2, nextAttempt - 1);
  return Math.min(24 * 60, minutes) * 60 * 1000;
}

// Finds articles whose RSS body was empty or too short, whose feed permits
// scraping, and which are past their scheduled retry time. Runs Steel →
// Browserless → Readability via scrapeAndPersist. On success (content reaches
// the minimum word count), retry bookkeeping is cleared so the article drops
// out of the partial index. On failure, increments scrape_retry_count and
// schedules the next attempt.
export async function retryEmptyArticles(env: Env): Promise<void> {
  const db = env.DB;
  const now = Date.now();

  const hasScrapers = Boolean(env.STEEL_API_KEY || env.BROWSERLESS_API_KEY);
  if (!hasScrapers) return;

  // Pull last-attempt metadata too. extraction_method tells us which provider
  // was used last — we use that to flip to the other one on low-quality
  // outcomes (chunk 4). Queries used to read just scrape_provider from the
  // feed config; now we override that with article-history when applicable.
  const articles = await dbAll<{
    id: string;
    canonical_url: string;
    scrape_retry_count: number;
    scrape_provider: string | null;
    extraction_method: string | null;
    extraction_quality: number | null;
  }>(
    db,
    `SELECT a.id, a.canonical_url, a.scrape_retry_count,
            a.extraction_method, a.extraction_quality,
            (SELECT f2.scrape_provider FROM article_sources src2
                    JOIN feeds f2 ON f2.id = src2.feed_id
                   WHERE src2.article_id = a.id AND f2.scrape_provider IS NOT NULL
                   LIMIT 1) AS scrape_provider
       FROM articles a
       JOIN article_sources asrc ON asrc.article_id = a.id
       JOIN feeds f ON f.id = asrc.feed_id
      WHERE (a.content_text IS NULL OR length(a.content_text) < ?)
        AND a.scrape_retry_count < ?
        AND (a.next_scrape_attempt_at IS NULL OR a.next_scrape_attempt_at <= ?)
        AND f.scrape_mode != 'rss_only'
        AND f.disabled = 0
      GROUP BY a.id
      ORDER BY COALESCE(a.published_at, a.fetched_at) DESC
      LIMIT ?`,
    [MIN_CONTENT_WORDS, MAX_RETRIES, now, BATCH_SIZE],
  );

  if (articles.length === 0) return;

  let successes = 0;
  let failures = 0;
  let quarantined = 0;
  let escalations = 0;

  for (const article of articles) {
    // If the LAST attempt was a low-quality result from a known provider,
    // escalate to the other provider on this retry. Otherwise honor the
    // feed's configured preference. The escalated choice gets passed as
    // preferredProvider — scrapeAndExtract still falls back to the other
    // provider if this one errors at the HTTP layer, which is fine.
    const lastQuality = article.extraction_quality ?? null;
    const wasLowQuality = lastQuality !== null && lastQuality < MIN_EXTRACTION_QUALITY;
    const escalated = wasLowQuality ? escalatedProvider(article.extraction_method) : null;
    const preferred = escalated ?? (article.scrape_provider as ScrapeProvider | null) ?? null;
    if (escalated) escalations++;

    const result = await scrapeAndPersist(db, env, {
      id: article.id,
      canonical_url: article.canonical_url,
      preferredProvider: preferred,
    });

    // Recovery now requires BOTH min word count AND min quality. A long
    // paywall stub passes the word count check but won't pass quality, so
    // we keep retrying it (until MAX_RETRIES) instead of marking recovered.
    const newQuality = result.scraped?.extractionQuality ?? 0;
    const recovered =
      result.ok &&
      result.scraped !== undefined &&
      result.scraped.wordCount >= MIN_CONTENT_WORDS &&
      newQuality >= MIN_EXTRACTION_QUALITY;

    if (recovered) {
      await dbRun(
        db,
        `UPDATE articles SET scrape_retry_count = 0, next_scrape_attempt_at = NULL WHERE id = ?`,
        [article.id],
      );
      successes++;
    } else {
      const nextAttempt = (article.scrape_retry_count ?? 0) + 1;
      // When the article has exhausted its retry budget without recovering,
      // quarantine it so it stops appearing in user-facing feeds. Manual
      // unquarantine is available via /admin/articles/:id/unquarantine.
      if (nextAttempt >= MAX_RETRIES) {
        await dbRun(
          db,
          `UPDATE articles SET scrape_retry_count = ?,
             next_scrape_attempt_at = NULL,
             quarantined_at = COALESCE(quarantined_at, ?)
           WHERE id = ?`,
          [nextAttempt, now, article.id],
        );
        quarantined++;
      } else {
        const nextAt = now + backoffMs(nextAttempt);
        await dbRun(
          db,
          `UPDATE articles SET scrape_retry_count = ?, next_scrape_attempt_at = ? WHERE id = ?`,
          [nextAttempt, nextAt, article.id],
        );
      }
      failures++;
    }
  }

  console.log(
    `[retry-empty-articles] batch=${articles.length} success=${successes} failure=${failures} escalations=${escalations} quarantined=${quarantined}`,
  );
}
