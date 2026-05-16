-- Migration 0028 — YouTube transcript metadata
--
-- M2 of the 6-month roadmap. New columns on articles to track per-video
-- transcript state: when fetched, what language, how many attempts,
-- last error reason. Partial index on (source_type, transcript_fetched_at,
-- transcript_attempt_count) supports the hourly cron's pending-transcripts
-- selector query cheaply.

ALTER TABLE articles ADD COLUMN transcript_fetched_at INTEGER;
ALTER TABLE articles ADD COLUMN transcript_lang TEXT;
ALTER TABLE articles ADD COLUMN transcript_attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE articles ADD COLUMN transcript_last_error TEXT;

CREATE INDEX idx_articles_transcript_pending
  ON articles (source_type, transcript_fetched_at, transcript_attempt_count)
  WHERE source_type = 'youtube';
