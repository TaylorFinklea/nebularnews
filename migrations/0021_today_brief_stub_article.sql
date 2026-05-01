-- Migration: Seed `__today_brief__` stub article for the M18 chat-first Today tab.
--
-- M18 added a third sentinel article id (`__today_brief__`) for the chat thread
-- that powers the Today tab, but didn't extend migration 0011's stub seed —
-- so the FK from chat_threads.article_id → articles.id violated on every Today
-- tab open, which manifested as ensureTodayBriefSeed throwing 500 silently.
-- This patches up production envs that don't have the stub yet.

INSERT OR IGNORE INTO articles (id, canonical_url, title, fetched_at)
VALUES (
  '__today_brief__',
  'nebularnews://virtual/today-brief',
  'Today Brief',
  unixepoch() * 1000
);
