-- Migration 0026 — OAuth 2.0 authorization-code + PKCE provider so MCP
-- clients (Claude desktop, ChatGPT custom GPTs, etc.) can authorize a user
-- against this server. Lives alongside the existing better-auth `session`
-- table; the auth middleware checks both lookups so a Bearer token can be
-- either a better-auth session or an OAuth access token.

CREATE TABLE oauth_clients (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL UNIQUE,
  client_secret TEXT NOT NULL,         -- bcrypt-hashed; never returned to clients
  redirect_uris TEXT NOT NULL,         -- JSON array of allowed redirect URIs
  client_name TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE oauth_authorization_codes (
  code TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT,                 -- PKCE
  code_challenge_method TEXT,          -- 'S256' or 'plain'
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_oauth_codes_expires ON oauth_authorization_codes (expires_at);

CREATE TABLE oauth_access_tokens (
  token TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_oauth_tokens_user ON oauth_access_tokens (user_id);
CREATE INDEX idx_oauth_tokens_expires ON oauth_access_tokens (expires_at);

-- Seed the canonical Claude desktop client.
--
-- IMPORTANT: in this Phase-1 implementation the client_secret is stored as
-- plain text and compared with a constant-time equality check. Hardening to
-- bcrypt/SubtleCrypto-backed hashing is queued for Phase 1.5 — that change
-- is a server-only update + a one-time migration to rehash existing rows.
--
-- The dev seed below uses a known secret. Rotate it for production via:
--   wrangler d1 execute nebular-news-prod --command \
--     "UPDATE oauth_clients SET client_secret = '<new_secret>' \
--      WHERE client_id = 'claude-desktop-prod'"
INSERT INTO oauth_clients (id, client_id, client_secret, redirect_uris, client_name, created_at, updated_at)
VALUES (
  'claude-desktop-prod',
  'claude-desktop-prod',
  'dev-only-rotate-in-prod',
  '["https://claude.ai/api/mcp/auth_callback","claude://mcp/callback","http://localhost:8787/oauth/test"]',
  'Claude Desktop',
  strftime('%s', 'now') * 1000,
  strftime('%s', 'now') * 1000
);
