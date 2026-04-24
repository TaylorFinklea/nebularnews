-- Migration: Scrape retry loop + default mode flip
--
-- Part 1: Background-retry bookkeeping on articles.
--   scrape_retry_count    — counts only retry-cron attempts (distinct from
--                           fetch_attempt_count, which also bumps for user-
--                           initiated on-demand fetches so users don't eat the
--                           retry budget).
--   next_scrape_attempt_at — unix ms; null means the retry cron can pick this
--                           row up immediately. Populated on retry failure
--                           using exponential backoff (15m, 30m, 1h, 2h, 4h,
--                           capped at 24h).
--
-- Part 2: Flip existing rss_only feeds to auto_fetch_on_empty. Most historical
--   feeds are stuck on rss_only (the old default) and therefore never trigger
--   Steel/Browserless even when their RSS body is empty. auto_fetch_on_empty
--   is the right floor: extract when RSS is thin, leave alone when RSS is rich.
--
--   The column default stays 'rss_only' in the initial schema; new feed-
--   creation code paths must pass 'auto_fetch_on_empty' explicitly. Changing a
--   column default in SQLite requires a table rebuild, which is not worth the
--   blast radius here.

ALTER TABLE articles ADD COLUMN scrape_retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE articles ADD COLUMN next_scrape_attempt_at INTEGER;

-- Partial index for the retry-cron hot path. Only rows with empty-ish bodies
-- and a backoff time set are candidates; the WHERE clause keeps the index
-- small and the scan cheap.
CREATE INDEX IF NOT EXISTS idx_articles_scrape_retry
  ON articles(next_scrape_attempt_at, scrape_retry_count)
  WHERE scrape_retry_count < 5
    AND (content_text IS NULL OR length(content_text) < 50);

-- One-shot migration: upgrade legacy rss_only feeds so the retry cron and
-- poll-feeds both have permission to scrape them. Feeds explicitly set to
-- 'always' or already on 'auto_fetch_on_empty' are left alone.
UPDATE feeds
   SET scrape_mode = 'auto_fetch_on_empty'
 WHERE scrape_mode = 'rss_only';
