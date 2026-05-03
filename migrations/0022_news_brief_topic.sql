-- Migration: per-topic brief support.
--
-- /api/brief/generate already accepts `topic_tag_id` to filter candidate
-- articles by tag, but the resulting brief was persisted without recording
-- *which* topic produced it. That was fine when topics were a query-time
-- concern only, but the iOS Today surface now lets users generate topic
-- briefs that need to be distinguishable from the all-news brief in
-- history (BriefHistoryView) and detail (BriefDetailView). Persisting the
-- tag id makes that distinction durable and lets us label rows in the
-- history list with the topic name.

ALTER TABLE news_brief_editions ADD COLUMN topic_tag_id TEXT;
CREATE INDEX IF NOT EXISTS idx_news_brief_editions_topic
  ON news_brief_editions(user_id, topic_tag_id, generated_at DESC)
  WHERE topic_tag_id IS NOT NULL;
