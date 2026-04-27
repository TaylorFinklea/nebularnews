-- Migration: chat_messages.message_kind
--
-- Distinguishes structured brief seeds, tool results, and system notes from
-- normal text messages so iOS can render them with custom views (e.g. the
-- new BriefMessageView with per-bullet action chips). The streaming path is
-- unchanged — only the seed message uses a non-default kind.
--
-- Values: 'text' (default) | 'brief_seed' | 'tool_result' | 'system_note'.
-- Adding the column with a default keeps existing rows valid; the partial
-- index makes "find this thread's brief seed" a constant-time lookup.

ALTER TABLE chat_messages ADD COLUMN message_kind TEXT NOT NULL DEFAULT 'text';

CREATE INDEX IF NOT EXISTS idx_chat_messages_thread_kind
  ON chat_messages(thread_id, created_at)
  WHERE message_kind = 'brief_seed';
