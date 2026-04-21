-- Migration: Drop the UNIQUE(user_id, article_id) constraint on chat_threads.
--
-- The original schema enforced one chat thread per (user, article). That made
-- sense for article-specific chat (one ongoing conversation per article), but
-- breaks the floating assistant which uses a single sentinel article_id
-- (__assistant__) and is supposed to support multiple separate conversations
-- accessible via the assistant history view + "+" new chat button.
--
-- SQLite can't drop a constraint in place. We recreate the table without the
-- UNIQUE clause and copy the data. PRIMARY KEY and FOREIGN KEYS are preserved.

-- Defer FK checks for the duration of the swap so dependent rows in
-- chat_messages aren't cascaded away.
PRAGMA foreign_keys = OFF;

CREATE TABLE chat_threads_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  article_id TEXT,
  title TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES user(id) ON DELETE CASCADE,
  FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE
);

INSERT INTO chat_threads_new (id, user_id, article_id, title, created_at, updated_at)
SELECT id, user_id, article_id, title, created_at, updated_at FROM chat_threads;

DROP TABLE chat_threads;
ALTER TABLE chat_threads_new RENAME TO chat_threads;

-- Helpful indexes for the common access patterns.
CREATE INDEX IF NOT EXISTS idx_chat_threads_user_article ON chat_threads(user_id, article_id);
CREATE INDEX IF NOT EXISTS idx_chat_threads_updated ON chat_threads(updated_at DESC);

PRAGMA foreign_keys = ON;
