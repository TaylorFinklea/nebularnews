-- Migration: track cumulative reading time per (user, article).
--
-- Scoring v2 adds a `time_spent` signal aggregated per feed: articles from
-- feeds where the user spends real time get a small score boost. The signal
-- needs a server-side cumulative counter so re-opens of the same article
-- compose naturally (a single 60-second session followed by a second 30-second
-- session ends up at 90s, not 30s).
--
-- last_read_at lets the cron consider recency of engagement separately from
-- the existing updated_at column, which gets bumped by reading-position
-- writes that don't necessarily indicate a real read.

ALTER TABLE article_read_state ADD COLUMN time_spent_ms_total INTEGER NOT NULL DEFAULT 0;
ALTER TABLE article_read_state ADD COLUMN last_read_at INTEGER;
