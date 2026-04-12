-- Migration: Intelligence layer — topic clustering, trends, reading insights
-- Part of M6: AI Overhaul — Phase D

-- ── Topic clusters ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS topic_clusters (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  tag_ids_json TEXT NOT NULL,
  article_count INTEGER NOT NULL DEFAULT 0,
  latest_article_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  FOREIGN KEY(user_id) REFERENCES user(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_topic_clusters_user ON topic_clusters(user_id);

-- ── Topic trends ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS topic_trends (
  id TEXT PRIMARY KEY,
  cluster_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  trend_score REAL NOT NULL DEFAULT 0,
  article_count_24h INTEGER NOT NULL DEFAULT 0,
  article_count_7d_avg REAL NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL,
  window_end INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  FOREIGN KEY(cluster_id) REFERENCES topic_clusters(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES user(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_topic_trends_user ON topic_trends(user_id, created_at DESC);

-- ── Reading insights ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS reading_insights (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  insight_type TEXT NOT NULL DEFAULT 'weekly',
  insight_text TEXT NOT NULL,
  data_json TEXT,
  period_start INTEGER NOT NULL,
  period_end INTEGER NOT NULL,
  provider TEXT,
  model TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  FOREIGN KEY(user_id) REFERENCES user(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_reading_insights_user ON reading_insights(user_id, created_at DESC);
