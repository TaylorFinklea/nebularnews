-- Migration: reading position tracking on article_read_state.
--
-- M16 adds a "Continue reading" resume card to the Today view. Scroll position
-- is stored as an integer percent (0-100) of the article's total scrollable
-- height. Nullable so existing rows don't need a backfill; a NULL value means
-- "we don't know yet" and is treated as "never started" by /today's resume
-- query. Valid range for an in-progress article is 1-94 (inclusive).

ALTER TABLE article_read_state
  ADD COLUMN read_position_percent INTEGER DEFAULT NULL;

-- Index for the Today resume query: latest in-progress row per user.
CREATE INDEX IF NOT EXISTS idx_article_read_state_resume
  ON article_read_state(user_id, updated_at DESC)
  WHERE read_position_percent BETWEEN 1 AND 94 AND is_read = 0;
