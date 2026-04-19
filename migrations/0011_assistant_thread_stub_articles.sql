-- Migration: Seed stub articles for virtual chat threads.
--
-- `chat_threads.article_id` has a FOREIGN KEY to `articles.id`. The chat code
-- uses two sentinel ids (`__assistant__`, `__multi_chat__`) to track virtual
-- threads that aren't tied to a real article — which is a FK violation whenever
-- we try to insert a new thread row for the floating assistant. Seed two stub
-- articles with deterministic ids so the FK constraint is satisfied without
-- changing the application code or the chat_threads schema.

INSERT OR IGNORE INTO articles (id, canonical_url, title, fetched_at)
VALUES
  ('__assistant__', 'nebularnews://virtual/assistant', 'Floating AI Assistant', unixepoch() * 1000),
  ('__multi_chat__', 'nebularnews://virtual/multi-chat', 'Today''s News Chat', unixepoch() * 1000);
