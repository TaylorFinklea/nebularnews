PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS feeds (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  title TEXT,
  site_url TEXT,
  etag TEXT,
  last_modified TEXT,
  last_polled_at INTEGER,
  next_poll_at INTEGER,
  error_count INTEGER NOT NULL DEFAULT 0,
  disabled INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  canonical_url TEXT NOT NULL UNIQUE,
  guid TEXT,
  title TEXT,
  author TEXT,
  published_at INTEGER,
  fetched_at INTEGER,
  content_html TEXT,
  content_text TEXT,
  excerpt TEXT,
  word_count INTEGER,
  content_hash TEXT UNIQUE,
  status TEXT
);

CREATE TABLE IF NOT EXISTS article_sources (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL,
  feed_id TEXT NOT NULL,
  item_guid TEXT,
  original_url TEXT,
  published_at INTEGER,
  UNIQUE(feed_id, item_guid),
  FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE,
  FOREIGN KEY(feed_id) REFERENCES feeds(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS article_summaries (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  summary_text TEXT NOT NULL,
  key_points_json TEXT,
  created_at INTEGER NOT NULL,
  token_usage_json TEXT,
  prompt_version TEXT,
  FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS article_scores (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL,
  score INTEGER NOT NULL,
  label TEXT,
  reason_text TEXT,
  evidence_json TEXT,
  created_at INTEGER NOT NULL,
  profile_version INTEGER,
  FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS article_score_overrides (
  article_id TEXT PRIMARY KEY,
  score INTEGER NOT NULL CHECK (score >= 1 AND score <= 5),
  comment TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS article_feedback (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL,
  feed_id TEXT,
  rating INTEGER NOT NULL,
  comment TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE,
  FOREIGN KEY(feed_id) REFERENCES feeds(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS article_reactions (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL UNIQUE,
  feed_id TEXT NOT NULL,
  value INTEGER NOT NULL CHECK (value IN (-1, 1)),
  created_at INTEGER NOT NULL,
  FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE,
  FOREIGN KEY(feed_id) REFERENCES feeds(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chat_threads (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  article_id TEXT,
  title TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  token_usage_json TEXT,
  FOREIGN KEY(thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS preference_profile (
  id TEXT PRIMARY KEY,
  profile_text TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_keys (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL UNIQUE,
  encrypted_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  article_id TEXT,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  run_after INTEGER NOT NULL,
  last_error TEXT,
  provider TEXT,
  model TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS article_search USING fts5(
  article_id UNINDEXED,
  title,
  content_text,
  summary_text,
  tokenize = 'porter'
);

CREATE INDEX IF NOT EXISTS idx_feeds_next_poll ON feeds(next_poll_at);
CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published_at);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, run_after);
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_unique ON jobs(type, article_id);
CREATE INDEX IF NOT EXISTS idx_article_sources_article ON article_sources(article_id);
CREATE INDEX IF NOT EXISTS idx_article_scores_article ON article_scores(article_id);
CREATE INDEX IF NOT EXISTS idx_article_feedback_article ON article_feedback(article_id);
CREATE INDEX IF NOT EXISTS idx_article_feedback_feed ON article_feedback(feed_id);
CREATE INDEX IF NOT EXISTS idx_article_reactions_feed ON article_reactions(feed_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_thread ON chat_messages(thread_id);
