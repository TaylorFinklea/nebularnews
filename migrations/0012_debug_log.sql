-- Migration: Temporary debug log table for chat assistant diagnostics.
-- Remove once the /chat/assistant 500 root-cause is pinned down.

CREATE TABLE IF NOT EXISTS debug_log (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  scope TEXT NOT NULL,
  event TEXT NOT NULL,
  data TEXT
);

CREATE INDEX IF NOT EXISTS idx_debug_log_created ON debug_log(created_at DESC);
