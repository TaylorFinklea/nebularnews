-- Stores in-flight tool-call proposals awaiting user confirmation.
-- Rows are short-lived (TTL ~10 minutes); a daily cron evicts stale rows.
CREATE TABLE tool_call_proposals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  args_json TEXT NOT NULL,                  -- the full call.args JSON
  preview_summary TEXT NOT NULL,            -- e.g. "Mark 47 articles as read in 3 feeds"
  preview_detail_json TEXT NOT NULL,        -- richer payload for the sheet (article titles, feed name, before/after values)
  conversation_snapshot_json TEXT NOT NULL, -- the partial `convo` array up to and including the tool_use turn, so the server can resume
  call_id TEXT NOT NULL,                    -- the AI-generated tool call id
  provider TEXT NOT NULL,                   -- 'openai' | 'anthropic'
  model TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,                      -- null until user confirms/rejects/expires
  resolution TEXT                           -- 'approved' | 'rejected' | 'expired'
);

CREATE INDEX idx_tool_call_proposals_user_active ON tool_call_proposals(user_id, resolved_at) WHERE resolved_at IS NULL;
CREATE INDEX idx_tool_call_proposals_created ON tool_call_proposals(created_at);
