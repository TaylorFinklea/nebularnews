-- Migration: support multi-conversation Agent tab.
--
-- Build 29 unified Today + the floating overlay onto one assistant thread;
-- Build 37 reverses that. Each Agent conversation is now a row in
-- chat_threads with optional pinned article_id, an actually-rendered
-- title, and soft-delete via deleted_at. The legacy __assistant__ thread
-- becomes the user's first migrated conversation; brief_seed messages
-- inside it stay in the DB but are filtered out of Agent rendering.
--
-- title and article_id columns already exist on chat_threads — we just
-- start populating title (auto-heuristic from the first user message) and
-- using article_id as the pinned-article reference.

ALTER TABLE chat_threads ADD COLUMN deleted_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_chat_threads_user_updated
  ON chat_threads (user_id, updated_at DESC);
