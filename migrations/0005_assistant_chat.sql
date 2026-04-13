-- Migration: AI Assistant chat support
-- Adds page context tracking to chat messages for the floating assistant

ALTER TABLE chat_messages ADD COLUMN page_context_json TEXT;
