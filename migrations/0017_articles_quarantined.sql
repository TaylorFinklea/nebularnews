-- Migration: articles.quarantined_at
--
-- Closes the loop on chunks 2 and 4 of the design-wait pass. Articles that
-- have permanently failed extraction (PDF/JSON content, parse failures, or
-- exhausted retry budget without recovery) get a quarantine timestamp set.
-- User-facing endpoints filter on `quarantined_at IS NULL` by default, so
-- iOS feeds stop showing perpetual 0-content articles. Admin can opt back
-- in with ?include_quarantined=true and unquarantine via dedicated endpoint.
--
-- The partial index narrows the default-case query (active articles) without
-- bloating index storage on the typically-small quarantined set.

ALTER TABLE articles ADD COLUMN quarantined_at INTEGER DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_articles_active
  ON articles(fetched_at DESC)
  WHERE quarantined_at IS NULL;
