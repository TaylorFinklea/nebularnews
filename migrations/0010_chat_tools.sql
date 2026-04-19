-- Migration: Chat message tool-calling support
-- Adds JSON column to chat_messages to persist tool invocation sequences
-- alongside the assistant's text content. Nullable so existing rows
-- (which pre-date M11 tool-calling) are unaffected.

ALTER TABLE chat_messages ADD COLUMN tool_calls_json TEXT;
