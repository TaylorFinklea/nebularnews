-- Migration: provider call + usage observability
--
-- Tracks every Steel/Browserless call so we can see when scrape costs spike
-- and correlate with the providers' invoices. The retry cron's quality-based
-- escalation (chunk 4) is the most likely cost driver — we want a daily view
-- of how many calls each provider got and how often they succeeded.
--
-- Two tables: a hot per-call log (pruned at 30 days), and a long-lived
-- daily rollup. Today's running totals are computed live from the hot log
-- since the daily cron only runs once at 3:30am.

CREATE TABLE IF NOT EXISTS provider_calls (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,            -- 'steel' | 'browserless'
  started_at INTEGER NOT NULL,       -- unix ms
  duration_ms INTEGER NOT NULL,      -- includes timeout-aborts
  success INTEGER NOT NULL,          -- 0 or 1
  error_class TEXT,                  -- 'timeout' | 'http_4xx' | 'http_5xx' | 'abort' | 'network' | NULL on success
  article_id TEXT                    -- nullable; populated when call is on behalf of an article
);

-- Hot read path: "give me last 24h of activity for /admin/usage today bucket".
CREATE INDEX IF NOT EXISTS idx_provider_calls_started ON provider_calls(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_provider_calls_provider_started ON provider_calls(provider, started_at DESC);

CREATE TABLE IF NOT EXISTS provider_usage_daily (
  provider TEXT NOT NULL,
  day_unix INTEGER NOT NULL,         -- unix ms truncated to UTC midnight
  call_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  total_duration_ms INTEGER NOT NULL DEFAULT 0,
  p50_duration_ms INTEGER,           -- nullable when call_count is 0
  p95_duration_ms INTEGER,
  computed_at INTEGER NOT NULL,      -- when the rollup was computed (idempotent re-runs)
  PRIMARY KEY (provider, day_unix)
);

CREATE INDEX IF NOT EXISTS idx_provider_usage_day ON provider_usage_daily(day_unix DESC);
