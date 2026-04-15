-- Migration: Inbox unification — email newsletter ingestion + web clipper
-- Part of M7

CREATE TABLE IF NOT EXISTS email_ingest_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  token TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  FOREIGN KEY(user_id) REFERENCES user(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_email_ingest_tokens_token ON email_ingest_tokens(token);
