-- Migration: Conversation memory for cross-article chat context
-- Part of M6: AI Overhaul — Phase C2

CREATE TABLE IF NOT EXISTS chat_context_summaries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  article_id TEXT,
  article_title TEXT,
  summary TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  FOREIGN KEY(user_id) REFERENCES user(id) ON DELETE CASCADE,
  FOREIGN KEY(thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chat_context_summaries_user ON chat_context_summaries(user_id, created_at DESC);
