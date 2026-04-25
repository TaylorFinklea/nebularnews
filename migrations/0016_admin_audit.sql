-- Migration: admin audit log
--
-- Defense in depth. With CF Access + Apple Sign In layered, the surface
-- area for unauthorized admin access is small, but every mutation through
-- /admin/* should still leave a paper trail. We intentionally only log
-- POST/PATCH/DELETE — admin GETs are read-only and would explode the
-- table at zero-information value.
--
-- The web admin doesn't render this yet (design-blocked) — we just need
-- the data when it does.

CREATE TABLE IF NOT EXISTS admin_audit (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  method TEXT NOT NULL,           -- POST | PATCH | DELETE
  path TEXT NOT NULL,             -- /admin/feeds/foo, /admin/articles/bar/rescrape, etc.
  params_json TEXT,               -- {feedId: "..."}, {articleId: "..."}, ...
  body_json TEXT,                 -- request body as captured. Currently no
                                  -- known admin endpoint sends secrets here;
                                  -- add a redactor in the middleware if that
                                  -- changes.
  status_code INTEGER,            -- response status the handler returned
  request_id TEXT,                -- from x-request-id (envelope middleware)
  created_at INTEGER NOT NULL,    -- unix ms
  FOREIGN KEY(user_id) REFERENCES user(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_user_created ON admin_audit(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_method_created ON admin_audit(method, created_at DESC);
