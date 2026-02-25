PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at INTEGER NOT NULL
);

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
  image_url TEXT,
  image_status TEXT,
  image_checked_at INTEGER,
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

CREATE TABLE IF NOT EXISTS article_key_points (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  key_points_json TEXT NOT NULL,
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

CREATE TABLE IF NOT EXISTS article_read_state (
  article_id TEXT PRIMARY KEY,
  is_read INTEGER NOT NULL CHECK (is_read IN (0, 1)),
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_normalized TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  color TEXT,
  description TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS article_tags (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'ai', 'system')),
  confidence REAL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(article_id, tag_id),
  FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE,
  FOREIGN KEY(tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS article_tag_suggestions (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL,
  name TEXT NOT NULL,
  name_normalized TEXT NOT NULL,
  confidence REAL,
  source_provider TEXT,
  source_model TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(article_id, name_normalized),
  FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS article_tag_suggestion_dismissals (
  article_id TEXT NOT NULL,
  name_normalized TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(article_id, name_normalized),
  FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE
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
  key_version INTEGER NOT NULL DEFAULT 1,
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
  priority INTEGER NOT NULL DEFAULT 100,
  run_after INTEGER NOT NULL,
  locked_by TEXT,
  locked_at INTEGER,
  lease_expires_at INTEGER,
  last_error TEXT,
  provider TEXT,
  model TEXT,
  created_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
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

CREATE TABLE IF NOT EXISTS pull_runs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  trigger TEXT NOT NULL,
  cycles INTEGER NOT NULL DEFAULT 1,
  started_at INTEGER,
  completed_at INTEGER,
  last_error TEXT,
  request_id TEXT,
  stats_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS job_runs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  status TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  duration_ms INTEGER,
  error TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS auth_attempts (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL UNIQUE,
  failed_count INTEGER NOT NULL DEFAULT 0,
  first_failed_at INTEGER,
  last_failed_at INTEGER,
  blocked_until INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  metadata_json TEXT,
  request_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_feeds_next_poll ON feeds(next_poll_at);
CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published_at);
CREATE INDEX IF NOT EXISTS idx_articles_image_status ON articles(image_status, image_checked_at);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, run_after);
CREATE INDEX IF NOT EXISTS idx_jobs_lease ON jobs(status, lease_expires_at);
CREATE INDEX IF NOT EXISTS idx_jobs_priority ON jobs(status, priority, run_after);
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_unique ON jobs(type, article_id);
CREATE INDEX IF NOT EXISTS idx_article_sources_article ON article_sources(article_id);
CREATE INDEX IF NOT EXISTS idx_article_scores_article ON article_scores(article_id);
CREATE INDEX IF NOT EXISTS idx_article_scores_article_created ON article_scores(article_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_article_summaries_article_created ON article_summaries(article_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_article_key_points_article ON article_key_points(article_id);
CREATE INDEX IF NOT EXISTS idx_article_key_points_article_created ON article_key_points(article_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_article_feedback_article ON article_feedback(article_id);
CREATE INDEX IF NOT EXISTS idx_article_feedback_feed ON article_feedback(feed_id);
CREATE INDEX IF NOT EXISTS idx_article_reactions_feed ON article_reactions(feed_id);
CREATE INDEX IF NOT EXISTS idx_article_read_state_updated ON article_read_state(updated_at);
CREATE INDEX IF NOT EXISTS idx_article_tags_article ON article_tags(article_id);
CREATE INDEX IF NOT EXISTS idx_article_tags_tag ON article_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_article_tag_suggestions_article ON article_tag_suggestions(article_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_article_tag_suggestions_name ON article_tag_suggestions(name_normalized);
CREATE INDEX IF NOT EXISTS idx_article_tag_dismissals_article ON article_tag_suggestion_dismissals(article_id);
CREATE INDEX IF NOT EXISTS idx_tags_updated ON tags(updated_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_thread ON chat_messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_pull_runs_status ON pull_runs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_job_runs_job ON job_runs(job_id, started_at);
CREATE INDEX IF NOT EXISTS idx_auth_attempts_identifier ON auth_attempts(identifier);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);

INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
VALUES (2, 'v2_prod_hardening', unixepoch() * 1000);

INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
VALUES (3, 'v3_query_indexes', unixepoch() * 1000);

INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
VALUES (4, 'v4_reliability_budgets', unixepoch() * 1000);

INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
VALUES (5, 'v5_tagging_v2_suggestions', unixepoch() * 1000);
