import type { Env } from '../env';
import { dbAll, dbRun } from '../db/helpers';
import { scrapeAndPersist, type ScrapeProvider } from '../lib/scraper';

const MIN_CONTENT_WORDS = 50;
const MAX_RETRIES = 5;
const BATCH_SIZE = 50;

// Exponential backoff for retry attempts. `nextAttempt` is 1-based, so the
// first failure waits 15m, the second 30m, the third 1h, the fourth 2h, the
// fifth 4h. Capped at 24h for defensive safety (cap never triggers at the
// current max-5 budget but keeps the function resilient to future tuning).
function backoffMs(nextAttempt: number): number {
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

  const articles = await dbAll<{
    id: string;
    canonical_url: string;
    scrape_retry_count: number;
    scrape_provider: string | null;
  }>(
    db,
    `SELECT a.id, a.canonical_url, a.scrape_retry_count,
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

  for (const article of articles) {
    const result = await scrapeAndPersist(db, env, {
      id: article.id,
      canonical_url: article.canonical_url,
      preferredProvider: (article.scrape_provider as ScrapeProvider) ?? null,
    });

    const recovered = result.ok
      && result.scraped !== undefined
      && result.scraped.wordCount >= MIN_CONTENT_WORDS;

    if (recovered) {
      await dbRun(
        db,
        `UPDATE articles SET scrape_retry_count = 0, next_scrape_attempt_at = NULL WHERE id = ?`,
        [article.id],
      );
      successes++;
    } else {
      const nextAttempt = (article.scrape_retry_count ?? 0) + 1;
      const nextAt = now + backoffMs(nextAttempt);
      await dbRun(
        db,
        `UPDATE articles SET scrape_retry_count = ?, next_scrape_attempt_at = ? WHERE id = ?`,
        [nextAttempt, nextAt, article.id],
      );
      failures++;
    }
  }

  console.log(
    `[retry-empty-articles] batch=${articles.length} success=${successes} failure=${failures}`,
  );
}
