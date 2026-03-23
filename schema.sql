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
  disabled INTEGER NOT NULL DEFAULT 0,
  extraction_success_count INTEGER NOT NULL DEFAULT 0,
  extraction_fail_count INTEGER NOT NULL DEFAULT 0,
  browser_scrape_enabled INTEGER NOT NULL DEFAULT 0
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
  extraction_method TEXT,
  extraction_quality REAL,
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
  scoring_method TEXT NOT NULL DEFAULT 'ai',
  score_status TEXT NOT NULL DEFAULT 'ready' CHECK (score_status IN ('ready', 'insufficient_signal')),
  confidence REAL,
  preference_confidence REAL,
  weighted_average REAL,
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

CREATE TABLE IF NOT EXISTS article_reaction_reasons (
  article_id TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (article_id, reason_code),
  FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS article_read_state (
  article_id TEXT PRIMARY KEY,
  is_read INTEGER NOT NULL CHECK (is_read IN (0, 1)),
  updated_at INTEGER NOT NULL,
  saved_at INTEGER,
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

CREATE TABLE IF NOT EXISTS news_brief_editions (
  id TEXT PRIMARY KEY,
  edition_key TEXT NOT NULL UNIQUE,
  edition_kind TEXT NOT NULL,
  edition_slot TEXT NOT NULL,
  timezone TEXT NOT NULL,
  scheduled_for INTEGER,
  window_start INTEGER NOT NULL,
  window_end INTEGER NOT NULL,
  score_cutoff INTEGER NOT NULL,
  status TEXT NOT NULL,
  candidate_count INTEGER NOT NULL DEFAULT 0,
  bullets_json TEXT NOT NULL DEFAULT '[]',
  source_article_ids_json TEXT NOT NULL DEFAULT '[]',
  provider TEXT,
  model TEXT,
  last_error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  locked_by TEXT,
  locked_at INTEGER,
  lease_expires_at INTEGER,
  run_after INTEGER NOT NULL,
  generated_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS article_search USING fts5(
  article_id UNINDEXED,
  title,
  content_text,
  summary_text,
  tokenize = 'porter'
);

DELETE FROM article_search;

INSERT INTO article_search (article_id, title, content_text, summary_text)
SELECT
  a.id,
  COALESCE(a.title, ''),
  COALESCE(a.content_text, ''),
  COALESCE((
    SELECT s.summary_text
    FROM article_summaries s
    WHERE s.article_id = a.id
    ORDER BY s.created_at DESC
    LIMIT 1
  ), '')
FROM articles a;

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

CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id TEXT PRIMARY KEY,
  client_name TEXT NOT NULL,
  redirect_uris_json TEXT NOT NULL,
  grant_types_json TEXT NOT NULL,
  response_types_json TEXT NOT NULL,
  token_endpoint_auth_method TEXT NOT NULL,
  scope TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_used_at INTEGER
);

CREATE TABLE IF NOT EXISTS oauth_consents (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  granted_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(client_id, user_id, scope),
  FOREIGN KEY(client_id) REFERENCES oauth_clients(client_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  client_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  scope TEXT NOT NULL,
  resource TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  code_challenge_method TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(client_id) REFERENCES oauth_clients(client_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS oauth_access_tokens (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  client_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  resource TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  FOREIGN KEY(client_id) REFERENCES oauth_clients(client_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  client_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  resource TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  rotated_from_id TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  FOREIGN KEY(client_id) REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  FOREIGN KEY(rotated_from_id) REFERENCES oauth_refresh_tokens(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS device_tokens (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL DEFAULT 'ios',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_feeds_next_poll ON feeds(next_poll_at);
CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published_at);
CREATE INDEX IF NOT EXISTS idx_articles_image_status ON articles(image_status, image_checked_at);
CREATE INDEX IF NOT EXISTS idx_articles_extraction_quality ON articles(extraction_quality, extraction_method);
CREATE INDEX IF NOT EXISTS idx_news_brief_editions_status_run_after ON news_brief_editions(status, run_after);
CREATE INDEX IF NOT EXISTS idx_news_brief_editions_generated_at ON news_brief_editions(generated_at DESC, scheduled_for DESC);
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
CREATE INDEX IF NOT EXISTS idx_article_reaction_reasons_code ON article_reaction_reasons(reason_code);
CREATE INDEX IF NOT EXISTS idx_article_read_state_updated ON article_read_state(updated_at);
CREATE INDEX IF NOT EXISTS idx_article_tags_article ON article_tags(article_id);
CREATE INDEX IF NOT EXISTS idx_article_tags_tag ON article_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_article_tag_suggestions_article ON article_tag_suggestions(article_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_article_tag_suggestions_name ON article_tag_suggestions(name_normalized);
CREATE INDEX IF NOT EXISTS idx_article_tag_dismissals_article ON article_tag_suggestion_dismissals(article_id);
CREATE INDEX IF NOT EXISTS idx_tags_updated ON tags(updated_at);
CREATE INDEX IF NOT EXISTS idx_pull_runs_status ON pull_runs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_job_runs_job ON job_runs(job_id, started_at);
CREATE INDEX IF NOT EXISTS idx_auth_attempts_identifier ON auth_attempts(identifier);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_oauth_consents_client ON oauth_consents(client_id);
CREATE INDEX IF NOT EXISTS idx_oauth_consents_revoked ON oauth_consents(revoked_at);
CREATE INDEX IF NOT EXISTS idx_oauth_codes_client ON oauth_authorization_codes(client_id);
CREATE INDEX IF NOT EXISTS idx_oauth_codes_expires ON oauth_authorization_codes(expires_at);
CREATE INDEX IF NOT EXISTS idx_oauth_access_tokens_client ON oauth_access_tokens(client_id);
CREATE INDEX IF NOT EXISTS idx_oauth_access_tokens_expires ON oauth_access_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_oauth_access_tokens_revoked ON oauth_access_tokens(revoked_at);
CREATE INDEX IF NOT EXISTS idx_oauth_access_tokens_last_used ON oauth_access_tokens(last_used_at);
CREATE INDEX IF NOT EXISTS idx_oauth_refresh_tokens_client ON oauth_refresh_tokens(client_id);
CREATE INDEX IF NOT EXISTS idx_oauth_refresh_tokens_expires ON oauth_refresh_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_oauth_refresh_tokens_revoked ON oauth_refresh_tokens(revoked_at);
CREATE INDEX IF NOT EXISTS idx_oauth_refresh_tokens_last_used ON oauth_refresh_tokens(last_used_at);

INSERT OR IGNORE INTO tags (id, name, name_normalized, slug, color, description, created_at, updated_at)
VALUES
  ('tag-artificial-intelligence', 'Artificial Intelligence', 'artificial intelligence', 'artificial-intelligence', NULL, NULL, unixepoch() * 1000, unixepoch() * 1000),
  ('tag-generative-ai', 'Generative AI', 'generative ai', 'generative-ai', NULL, NULL, unixepoch() * 1000, unixepoch() * 1000),
  ('tag-large-language-models', 'Large Language Models', 'large language models', 'large-language-models', NULL, NULL, unixepoch() * 1000, unixepoch() * 1000),
  ('tag-ai-agents', 'AI Agents', 'ai agents', 'ai-agents', NULL, NULL, unixepoch() * 1000, unixepoch() * 1000),
  ('tag-ai-safety', 'AI Safety', 'ai safety', 'ai-safety', NULL, NULL, unixepoch() * 1000, unixepoch() * 1000),
  ('tag-conversational-ai', 'Conversational AI', 'conversational ai', 'conversational-ai', NULL, NULL, unixepoch() * 1000, unixepoch() * 1000),
  ('tag-deep-learning', 'Deep Learning', 'deep learning', 'deep-learning', NULL, NULL, unixepoch() * 1000, unixepoch() * 1000),
  ('tag-robotics', 'Robotics', 'robotics', 'robotics', NULL, NULL, unixepoch() * 1000, unixepoch() * 1000),
  ('tag-cybersecurity', 'Cybersecurity', 'cybersecurity', 'cybersecurity', NULL, NULL, unixepoch() * 1000, unixepoch() * 1000),
  ('tag-cloud-infrastructure', 'Cloud Infrastructure', 'cloud infrastructure', 'cloud-infrastructure', NULL, NULL, unixepoch() * 1000, unixepoch() * 1000),
  ('tag-kubernetes', 'Kubernetes', 'kubernetes', 'kubernetes', NULL, NULL, unixepoch() * 1000, unixepoch() * 1000),
  ('tag-open-source', 'Open Source', 'open source', 'open-source', NULL, NULL, unixepoch() * 1000, unixepoch() * 1000),
  ('tag-developer-tools', 'Developer Tools', 'developer tools', 'developer-tools', NULL, NULL, unixepoch() * 1000, unixepoch() * 1000),
  ('tag-software-engineering', 'Software Engineering', 'software engineering', 'software-engineering', NULL, NULL, unixepoch() * 1000, unixepoch() * 1000),
  ('tag-semiconductors', 'Semiconductors', 'semiconductors', 'semiconductors', NULL, NULL, unixepoch() * 1000, unixepoch() * 1000),
  ('tag-gpus', 'GPUs', 'gpus', 'gpus', NULL, NULL, unixepoch() * 1000, unixepoch() * 1000),
  ('tag-data-centers', 'Data Centers', 'data centers', 'data-centers', NULL, NULL, unixepoch() * 1000, unixepoch() * 1000),
  ('tag-enterprise-software', 'Enterprise Software', 'enterprise software', 'enterprise-software', NULL, NULL, unixepoch() * 1000, unixepoch() * 1000),
  ('tag-startups', 'Startups', 'startups', 'startups', NULL, NULL, unixepoch() * 1000, unixepoch() * 1000),
  ('tag-regulation', 'Regulation', 'regulation', 'regulation', NULL, NULL, unixepoch() * 1000, unixepoch() * 1000),
  ('tag-privacy', 'Privacy', 'privacy', 'privacy', NULL, NULL, unixepoch() * 1000, unixepoch() * 1000),
  ('tag-iot', 'IoT', 'iot', 'iot', NULL, NULL, unixepoch() * 1000, unixepoch() * 1000),
  ('tag-consumer-hardware', 'Consumer Hardware', 'consumer hardware', 'consumer-hardware', NULL, NULL, unixepoch() * 1000, unixepoch() * 1000),
  ('tag-research', 'Research', 'research', 'research', NULL, NULL, unixepoch() * 1000, unixepoch() * 1000);

INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
VALUES (2, 'v2_prod_hardening', unixepoch() * 1000);

INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
VALUES (3, 'v3_query_indexes', unixepoch() * 1000);

INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
VALUES (4, 'v4_reliability_budgets', unixepoch() * 1000);

INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
VALUES (5, 'v5_tagging_v2_suggestions', unixepoch() * 1000);

INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
VALUES (7, 'v7_reaction_reason_chips', unixepoch() * 1000);

INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
VALUES (8, 'v8_score_status_metadata', unixepoch() * 1000);

INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
VALUES (9, 'v9_article_search_backfill', unixepoch() * 1000);

INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
VALUES (10, 'v10_news_brief_editions', unixepoch() * 1000);

INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
VALUES (11, 'v11_starter_tag_taxonomy', unixepoch() * 1000);

INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
VALUES (12, 'v12_public_mcp_oauth', unixepoch() * 1000);
