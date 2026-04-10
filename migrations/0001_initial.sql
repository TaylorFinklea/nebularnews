-- NebularNews initial schema for Cloudflare D1
-- Evolved from the old schema.sql with ADR-001 fixes:
--   1. No schema_migrations table (wrangler d1 migrations handles this)
--   2. FTS5 with incremental triggers (no full rebuilds)
--   3. content_hash is a regular INDEX, not UNIQUE (false dedup fix)
--   4. OAuth tables removed (better-auth handles auth)
--   5. better-auth tables added (user, session, account, verification)
--   6. Per-feed subscription settings (paused, max_articles_per_day, min_score)
--   7. Feed scrape settings (scrape_mode, scrape_provider, feed_type)
--   8. AI usage tracking (ai_usage)
--   9. Signal weights for scoring (signal_weights)

-- ── better-auth tables ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user (
  id TEXT PRIMARY KEY,
  name TEXT,
  email TEXT UNIQUE,
  emailVerified INTEGER DEFAULT 0,
  image TEXT,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY,
  expiresAt INTEGER NOT NULL,
  token TEXT NOT NULL UNIQUE,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  ipAddress TEXT,
  userAgent TEXT,
  userId TEXT NOT NULL,
  FOREIGN KEY(userId) REFERENCES user(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS account (
  id TEXT PRIMARY KEY,
  accountId TEXT NOT NULL,
  providerId TEXT NOT NULL,
  userId TEXT NOT NULL,
  accessToken TEXT,
  refreshToken TEXT,
  idToken TEXT,
  accessTokenExpiresAt INTEGER,
  refreshTokenExpiresAt INTEGER,
  scope TEXT,
  password TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  FOREIGN KEY(userId) REFERENCES user(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS verification (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expiresAt INTEGER NOT NULL,
  createdAt INTEGER,
  updatedAt INTEGER
);

-- ── Core content ─────────────────────────────────────────────────────────────

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
  browser_scrape_enabled INTEGER NOT NULL DEFAULT 0,
  scrape_mode TEXT NOT NULL DEFAULT 'rss_only',
  scrape_provider TEXT,
  feed_type TEXT NOT NULL DEFAULT 'standard',
  avg_extraction_quality REAL,
  scrape_article_count INTEGER NOT NULL DEFAULT 0,
  scrape_error_count INTEGER NOT NULL DEFAULT 0,
  last_scrape_error TEXT
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
  content_hash TEXT,
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
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  UNIQUE(feed_id, item_guid),
  FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE,
  FOREIGN KEY(feed_id) REFERENCES feeds(id) ON DELETE CASCADE
);

-- ── AI enrichment ────────────────────────────────────────────────────────────

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
  user_id TEXT NOT NULL,
  score INTEGER NOT NULL,
  label TEXT,
  reason_text TEXT,
  evidence_json TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  profile_version INTEGER,
  scoring_method TEXT NOT NULL DEFAULT 'ai',
  score_status TEXT NOT NULL DEFAULT 'ready' CHECK (score_status IN ('ready', 'insufficient_signal', 'done')),
  confidence REAL,
  preference_confidence REAL,
  weighted_average REAL,
  provider TEXT,
  model TEXT,
  FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES user(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS article_score_overrides (
  user_id TEXT NOT NULL,
  article_id TEXT NOT NULL,
  score INTEGER NOT NULL CHECK (score >= 1 AND score <= 5),
  comment TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, article_id),
  FOREIGN KEY(user_id) REFERENCES user(id) ON DELETE CASCADE,
  FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE
);

-- ── User data ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS article_feedback (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL,
  feed_id TEXT,
  rating INTEGER NOT NULL,
  comment TEXT,
  created_at INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE,
  FOREIGN KEY(feed_id) REFERENCES feeds(id) ON DELETE SET NULL,
  FOREIGN KEY(user_id) REFERENCES user(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS article_reactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  article_id TEXT NOT NULL,
  feed_id TEXT NOT NULL,
  value INTEGER NOT NULL CHECK (value IN (-1, 1)),
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, article_id),
  FOREIGN KEY(user_id) REFERENCES user(id) ON DELETE CASCADE,
  FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE,
  FOREIGN KEY(feed_id) REFERENCES feeds(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS article_reaction_reasons (
  user_id TEXT NOT NULL,
  article_id TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, article_id, reason_code),
  FOREIGN KEY(user_id) REFERENCES user(id) ON DELETE CASCADE,
  FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS article_read_state (
  user_id TEXT NOT NULL,
  article_id TEXT NOT NULL,
  is_read INTEGER NOT NULL CHECK (is_read IN (0, 1)),
  updated_at INTEGER NOT NULL,
  saved_at INTEGER,
  PRIMARY KEY (user_id, article_id),
  FOREIGN KEY(user_id) REFERENCES user(id) ON DELETE CASCADE,
  FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_feed_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  feed_id TEXT NOT NULL,
  paused INTEGER NOT NULL DEFAULT 0,
  max_articles_per_day INTEGER,
  min_score INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, feed_id),
  FOREIGN KEY(user_id) REFERENCES user(id) ON DELETE CASCADE,
  FOREIGN KEY(feed_id) REFERENCES feeds(id) ON DELETE CASCADE
);

-- ── Tags ─────────────────────────────────────────────────────────────────────

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
  user_id TEXT NOT NULL,
  article_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'ai', 'system')),
  confidence REAL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(user_id, article_id, tag_id),
  FOREIGN KEY(user_id) REFERENCES user(id) ON DELETE CASCADE,
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
  user_id TEXT NOT NULL,
  UNIQUE(article_id, name_normalized),
  FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES user(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS article_tag_suggestion_dismissals (
  user_id TEXT NOT NULL,
  article_id TEXT NOT NULL,
  name_normalized TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, article_id, name_normalized),
  FOREIGN KEY(user_id) REFERENCES user(id) ON DELETE CASCADE,
  FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE
);

-- ── Settings & profiles ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS settings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(user_id, key),
  FOREIGN KEY(user_id) REFERENCES user(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS preference_profile (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  profile_text TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  version INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES user(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS provider_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  encrypted_key TEXT NOT NULL,
  key_version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  status TEXT NOT NULL,
  UNIQUE(user_id, provider),
  FOREIGN KEY(user_id) REFERENCES user(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS signal_weights (
  user_id TEXT NOT NULL,
  signal_name TEXT NOT NULL,
  weight REAL NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  PRIMARY KEY(user_id, signal_name),
  FOREIGN KEY(user_id) REFERENCES user(id) ON DELETE CASCADE
);

-- ── Jobs & background work ───────────────────────────────────────────────────

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
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
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

-- ── Chat ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS chat_threads (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  article_id TEXT,
  title TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(user_id, article_id),
  FOREIGN KEY(user_id) REFERENCES user(id) ON DELETE CASCADE,
  FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  token_count INTEGER,
  provider TEXT,
  model TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE
);

-- ── News briefs ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS news_brief_editions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
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
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES user(id) ON DELETE CASCADE
);

-- ── Device tokens ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS device_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL DEFAULT 'ios',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES user(id) ON DELETE CASCADE
);

-- ── AI usage tracking ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_usage (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  tokens_input INTEGER NOT NULL DEFAULT 0,
  tokens_output INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  FOREIGN KEY(user_id) REFERENCES user(id) ON DELETE CASCADE
);

-- ── FTS5 full-text search ────────────────────────────────────────────────────

CREATE VIRTUAL TABLE IF NOT EXISTS article_search USING fts5(
  article_id UNINDEXED,
  title,
  content_text,
  summary_text,
  tokenize = 'porter'
);

-- ── Indexes ──────────────────────────────────────────────────────────────────

-- Auth
CREATE INDEX IF NOT EXISTS idx_session_userId ON session(userId);
CREATE INDEX IF NOT EXISTS idx_account_userId ON account(userId);

-- Feeds
CREATE INDEX IF NOT EXISTS idx_feeds_next_poll ON feeds(next_poll_at);

-- Articles
CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published_at);
CREATE INDEX IF NOT EXISTS idx_articles_content_hash ON articles(content_hash);
CREATE INDEX IF NOT EXISTS idx_articles_image_status ON articles(image_status, image_checked_at);

-- Article sources
CREATE INDEX IF NOT EXISTS idx_article_sources_article ON article_sources(article_id);
CREATE INDEX IF NOT EXISTS idx_article_sources_created ON article_sources(created_at);

-- Scores
CREATE INDEX IF NOT EXISTS idx_article_scores_article ON article_scores(article_id);
CREATE INDEX IF NOT EXISTS idx_article_scores_article_created ON article_scores(article_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_article_scores_user_method ON article_scores(user_id, scoring_method);

-- Summaries / key points
CREATE INDEX IF NOT EXISTS idx_article_summaries_article_created ON article_summaries(article_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_article_key_points_article_created ON article_key_points(article_id, created_at DESC);

-- Feedback / reactions
CREATE INDEX IF NOT EXISTS idx_article_feedback_article ON article_feedback(article_id);
CREATE INDEX IF NOT EXISTS idx_article_reactions_feed ON article_reactions(feed_id);
CREATE INDEX IF NOT EXISTS idx_article_reactions_user ON article_reactions(user_id);

-- Read state
CREATE INDEX IF NOT EXISTS idx_article_read_state_updated ON article_read_state(updated_at);

-- Tags
CREATE INDEX IF NOT EXISTS idx_article_tags_article ON article_tags(article_id);
CREATE INDEX IF NOT EXISTS idx_article_tags_tag ON article_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_article_tag_suggestions_article ON article_tag_suggestions(article_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_tags_updated ON tags(updated_at);

-- Jobs
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, run_after);
CREATE INDEX IF NOT EXISTS idx_jobs_priority ON jobs(status, priority, run_after);

-- Chat
CREATE INDEX IF NOT EXISTS idx_chat_threads_article ON chat_threads(article_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_thread ON chat_messages(thread_id, created_at);

-- News briefs
CREATE INDEX IF NOT EXISTS idx_news_brief_editions_status ON news_brief_editions(status, run_after);
CREATE INDEX IF NOT EXISTS idx_news_brief_editions_generated ON news_brief_editions(generated_at DESC);

-- Pull runs / job runs
CREATE INDEX IF NOT EXISTS idx_pull_runs_status ON pull_runs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_job_runs_job ON job_runs(job_id, started_at);

-- AI usage
CREATE INDEX IF NOT EXISTS idx_ai_usage_user ON ai_usage(user_id, created_at);

-- ── FTS5 triggers (incremental, no full rebuilds) ────────────────────────────

CREATE TRIGGER IF NOT EXISTS trg_articles_ai_insert AFTER INSERT ON articles
BEGIN
  INSERT INTO article_search (article_id, title, content_text, summary_text)
  VALUES (NEW.id, COALESCE(NEW.title, ''), COALESCE(NEW.content_text, ''), '');
END;

CREATE TRIGGER IF NOT EXISTS trg_articles_au_update AFTER UPDATE OF title, content_text ON articles
BEGIN
  DELETE FROM article_search WHERE article_id = OLD.id;
  INSERT INTO article_search (article_id, title, content_text, summary_text)
  VALUES (NEW.id, COALESCE(NEW.title, ''), COALESCE(NEW.content_text, ''),
    COALESCE((SELECT s.summary_text FROM article_summaries s WHERE s.article_id = NEW.id ORDER BY s.created_at DESC LIMIT 1), ''));
END;

CREATE TRIGGER IF NOT EXISTS trg_articles_ad_delete AFTER DELETE ON articles
BEGIN
  DELETE FROM article_search WHERE article_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_summaries_ai_insert AFTER INSERT ON article_summaries
BEGIN
  DELETE FROM article_search WHERE article_id = NEW.article_id;
  INSERT INTO article_search (article_id, title, content_text, summary_text)
  VALUES (NEW.article_id,
    COALESCE((SELECT title FROM articles WHERE id = NEW.article_id), ''),
    COALESCE((SELECT content_text FROM articles WHERE id = NEW.article_id), ''),
    COALESCE(NEW.summary_text, ''));
END;

-- ── Seed data ────────────────────────────────────────────────────────────────

INSERT OR IGNORE INTO tags (id, name, name_normalized, slug, color, description, created_at, updated_at) VALUES
  ('tag-artificial-intelligence', 'Artificial Intelligence', 'artificial intelligence', 'artificial-intelligence', NULL, NULL, unixepoch() * 1000, unixepoch() * 1000),
  ('tag-generative-ai', 'Generative AI', 'generative ai', 'generative-ai', NULL, NULL, unixepoch() * 1000, unixepoch() * 1000),
  ('tag-large-language-models', 'Large Language Models', 'large language models', 'large-language-models', NULL, NULL, unixepoch() * 1000, unixepoch() * 1000),
  ('tag-ai-agents', 'AI Agents', 'ai agents', 'ai-agents', NULL, NULL, unixepoch() * 1000, unixepoch() * 1000),
  ('tag-ai-safety', 'AI Safety', 'ai safety', 'ai-safety', NULL, NULL, unixepoch() * 1000, unixepoch() * 1000),
  ('tag-deep-learning', 'Deep Learning', 'deep learning', 'deep-learning', NULL, NULL, unixepoch() * 1000, unixepoch() * 1000),
  ('tag-robotics', 'Robotics', 'robotics', 'robotics', NULL, NULL, unixepoch() * 1000, unixepoch() * 1000),
  ('tag-cybersecurity', 'Cybersecurity', 'cybersecurity', 'cybersecurity', NULL, NULL, unixepoch() * 1000, unixepoch() * 1000),
  ('tag-cloud-infrastructure', 'Cloud Infrastructure', 'cloud infrastructure', 'cloud-infrastructure', NULL, NULL, unixepoch() * 1000, unixepoch() * 1000),
  ('tag-open-source', 'Open Source', 'open source', 'open-source', NULL, NULL, unixepoch() * 1000, unixepoch() * 1000),
  ('tag-developer-tools', 'Developer Tools', 'developer tools', 'developer-tools', NULL, NULL, unixepoch() * 1000, unixepoch() * 1000),
  ('tag-software-engineering', 'Software Engineering', 'software engineering', 'software-engineering', NULL, NULL, unixepoch() * 1000, unixepoch() * 1000),
  ('tag-semiconductors', 'Semiconductors', 'semiconductors', 'semiconductors', NULL, NULL, unixepoch() * 1000, unixepoch() * 1000),
  ('tag-startups', 'Startups', 'startups', 'startups', NULL, NULL, unixepoch() * 1000, unixepoch() * 1000),
  ('tag-regulation', 'Regulation', 'regulation', 'regulation', NULL, NULL, unixepoch() * 1000, unixepoch() * 1000),
  ('tag-privacy', 'Privacy', 'privacy', 'privacy', NULL, NULL, unixepoch() * 1000, unixepoch() * 1000),
  ('tag-research', 'Research', 'research', 'research', NULL, NULL, unixepoch() * 1000, unixepoch() * 1000);
