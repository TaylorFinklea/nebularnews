-- Migration 0027 — multi-source schema
--
-- Extends `feeds` and `articles` to represent non-RSS sources (Reddit
-- subreddits, YouTube channels, Substack publications) without forking the
-- core schema. The polymorphic `source_data_json` carries per-source
-- metadata (Reddit score/comment count, YouTube view count, Substack paid
-- flag, etc.) that the MCP tools surface to the LLM.
--
-- The CHECK constraint on `source_type` is intentionally enumerated rather
-- than free-form so we don't accumulate typo'd values; new source types are
-- added via follow-up migrations.

ALTER TABLE feeds ADD COLUMN source_type TEXT NOT NULL DEFAULT 'rss';
ALTER TABLE articles ADD COLUMN source_type TEXT NOT NULL DEFAULT 'rss';
ALTER TABLE articles ADD COLUMN source_data_json TEXT;

-- Existing RSS feed rows already use `feeds.url` uniqueness; for Reddit the
-- "url" is the subreddit name (`r/birding`), for YouTube the channel id, for
-- Substack the publication URL. The compound index lets the same string
-- coexist across types without changing existing RSS uniqueness behaviour.
CREATE UNIQUE INDEX idx_feeds_source_url ON feeds (source_type, url);

CREATE INDEX idx_articles_source_type ON articles (source_type);
