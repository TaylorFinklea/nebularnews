-- Migration 0025 — drop AI-only tables and the FTS triggers that reference
-- them. Phase 1 of the MCP-only pivot: the LLM (Claude/ChatGPT) does all
-- summarization/scoring/brief composition, so the cached AI artifacts are no
-- longer written. Reading state, reactions, tags, and engagement signals
-- survive — they're useful as MCP-exposed context for the LLM later.

-- Migration 0020 created tool_call_proposals with a FK to a non-existent
-- `users` (plural) table — better-auth's user table is singular `user`.
-- D1 enforces foreign keys, so dropping the row would fail FK validation.
-- Disable FK checks for the duration of this drop sweep; SQLite re-enables
-- them automatically at the end of the migration transaction.
PRAGMA foreign_keys = OFF;

-- FTS5 triggers from 0001_initial referenced article_summaries; drop them
-- before the underlying table to avoid a "no such table" on insert.
DROP TRIGGER IF EXISTS trg_summaries_ai_insert;
DROP TRIGGER IF EXISTS trg_summaries_ai_update;
DROP TRIGGER IF EXISTS trg_summaries_ai_delete;

-- AI-generated artifacts the LLM now produces on demand.
DROP TABLE IF EXISTS article_summaries;
DROP TABLE IF EXISTS article_key_points;
DROP TABLE IF EXISTS article_scores;
DROP TABLE IF EXISTS article_score_overrides;
DROP TABLE IF EXISTS article_feedback;
DROP TABLE IF EXISTS article_tag_suggestions;

-- Topic clustering / insights that lived as cron output.
DROP TABLE IF EXISTS topic_clusters;
DROP TABLE IF EXISTS topic_trends;
DROP TABLE IF EXISTS reading_insights;

-- Brief generation tables.
DROP TABLE IF EXISTS news_brief_editions;

-- BYOK + AI usage tracking.
DROP TABLE IF EXISTS ai_usage;
DROP TABLE IF EXISTS provider_keys;
DROP TABLE IF EXISTS provider_calls;
DROP TABLE IF EXISTS provider_usage_daily;

-- Scoring inputs that the cron used.
DROP TABLE IF EXISTS preference_profile;
DROP TABLE IF EXISTS signal_weights;

-- Chat / agent conversation history (Build 24/37 era).
DROP TABLE IF EXISTS chat_messages;
DROP TABLE IF EXISTS chat_threads;
-- tool_call_proposals (from migration 0020) has a broken FK reference to a
-- non-existent `users` table that breaks DROP under D1's FK enforcement.
-- It must be dropped out-of-band BEFORE this migration runs, e.g.:
--   wrangler d1 execute <db> --command "PRAGMA foreign_keys = OFF; \
--     DROP TABLE IF EXISTS tool_call_proposals;"
-- We intentionally do NOT drop it here so this migration can be applied
-- cleanly to environments where the table has already been removed.

-- iOS-only state.
DROP TABLE IF EXISTS device_tokens;
DROP TABLE IF EXISTS user_subscriptions;
DROP TABLE IF EXISTS settings;

-- Reactions / annotations / highlights — iOS UI affordances. Drop until a
-- future client surfaces them again. The MCP tools don't expose any of these.
DROP TABLE IF EXISTS article_reactions;
DROP TABLE IF EXISTS article_reaction_reasons;
DROP TABLE IF EXISTS article_annotations;
DROP TABLE IF EXISTS article_highlights;
