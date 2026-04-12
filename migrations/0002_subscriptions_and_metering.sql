-- Migration: Add subscription tiers, user subscriptions, and extend ai_usage
-- Part of M6: AI Overhaul — Phase A2 (Metering & Rate Limiting)

-- ── Subscription tiers ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS subscription_tiers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  daily_token_limit INTEGER NOT NULL,
  weekly_token_limit INTEGER NOT NULL,
  features_json TEXT,
  price_monthly_cents INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- Seed with two initial tiers
INSERT OR IGNORE INTO subscription_tiers (id, name, daily_token_limit, weekly_token_limit, features_json, price_monthly_cents, created_at)
VALUES
  ('basic', 'Basic', 100000, 500000, '["chat","summarize","key_points","score","brief"]', 299, unixepoch() * 1000),
  ('pro', 'Pro', 500000, 2500000, '["chat","summarize","key_points","score","brief","auto_enrich","batch_enrich","scheduled_brief"]', 799, unixepoch() * 1000);

-- ── User subscriptions ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  tier TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  transaction_id TEXT,
  original_transaction_id TEXT,
  receipt_data TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  UNIQUE(user_id),
  FOREIGN KEY(user_id) REFERENCES user(id) ON DELETE CASCADE,
  FOREIGN KEY(tier) REFERENCES subscription_tiers(id)
);

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user ON user_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_expires ON user_subscriptions(expires_at);

-- ── Extend ai_usage with endpoint and is_byok columns ──────────────────────

ALTER TABLE ai_usage ADD COLUMN endpoint TEXT;
ALTER TABLE ai_usage ADD COLUMN is_byok INTEGER NOT NULL DEFAULT 0;
