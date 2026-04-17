-- Migration: Deep fetch state tracking for empty-body articles
--
-- Adds bookkeeping columns so the on-demand and auto-triggered deep-fetch
-- paths can rate-limit attempts and surface errors to the client. Also
-- introduces the 'auto_fetch_on_empty' value for feeds.scrape_mode so feeds
-- like Anthropic can opt in to deep-fetch during the poll cron when the
-- RSS item lands with no body.

ALTER TABLE articles ADD COLUMN last_fetch_attempt_at INTEGER;
ALTER TABLE articles ADD COLUMN fetch_attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE articles ADD COLUMN last_fetch_error TEXT;

CREATE INDEX IF NOT EXISTS idx_articles_fetch_attempt ON articles(last_fetch_attempt_at);
