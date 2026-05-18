-- Migration 0029 — Email newsletter ingestion
--
-- M3 of the 6-month roadmap. Adds per-feed inbound email addresses and
-- TOFU (trust-on-first-use) sender locking to the feeds table. No new
-- articles columns — sender-mismatch quarantine reuses articles.quarantined_at
-- from migration 0017.
--
-- The UNIQUE index on inbound_address is partial (only when NOT NULL) so
-- non-email feeds skip the constraint entirely.

ALTER TABLE feeds ADD COLUMN inbound_address TEXT;
ALTER TABLE feeds ADD COLUMN expected_sender TEXT;

CREATE UNIQUE INDEX idx_feeds_inbound_address
  ON feeds (inbound_address)
  WHERE inbound_address IS NOT NULL;
