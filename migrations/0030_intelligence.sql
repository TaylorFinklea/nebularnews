-- Migration 0030 — Intelligence: URL-canonicalization dedup + MCP cursors
--
-- M4 of the 6-month roadmap. Adds `articles.canonical_url_normalized` so the
-- LLM's view of articles can collapse "same story from 4 sources" into one
-- entry with `also_seen_in` provenance. Also adds `mcp_cursors` so
-- `get_recent({ since_last_call: true })` works without client-tracked
-- timestamps.
--
-- The backfill UPDATE uses a SQL-approximated canonicalization (lowercase +
-- trailing-slash strip) rather than the full JS helper. Old articles with
-- ?utm_source=... won't cluster with newer post-M4 articles that had the utm
-- stripped at INSERT time. Acceptable at personal scale; a future one-shot
-- script can re-canonicalize if needed.

ALTER TABLE articles ADD COLUMN canonical_url_normalized TEXT;

CREATE INDEX idx_articles_canonical_normalized
  ON articles (canonical_url_normalized)
  WHERE canonical_url_normalized IS NOT NULL;

UPDATE articles
SET canonical_url_normalized = LOWER(
  CASE
    WHEN canonical_url LIKE '%/' AND canonical_url != '/' THEN SUBSTR(canonical_url, 1, LENGTH(canonical_url) - 1)
    ELSE canonical_url
  END
)
WHERE canonical_url_normalized IS NULL;

CREATE TABLE mcp_cursors (
  user_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  cursor_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, tool_name),
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);
