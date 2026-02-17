import type { Db } from './db';

let schemaReady = false;
let schemaInitPromise: Promise<void> | null = null;

const MAX_PUBLISHED_FUTURE_MS = 1000 * 60 * 60 * 24;
export const EXPECTED_SCHEMA_VERSION = 2;

const runSafe = async (db: Db, sql: string, params: unknown[] = []) => {
  try {
    await db.prepare(sql).bind(...params).run();
  } catch (err) {
    const message = String(err);
    if (message.includes('duplicate column name') || message.includes('already exists')) {
      return;
    }
    throw err;
  }
};

const ensureMigrationsTable = async (db: Db) => {
  await runSafe(
    db,
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    )`
  );
};

const getAppliedVersion = async (db: Db) => {
  try {
    const row = await db.prepare('SELECT COALESCE(MAX(version), 0) as version FROM schema_migrations').first<{ version: number }>();
    return Number(row?.version ?? 0);
  } catch {
    return 0;
  }
};

const markVersionApplied = async (db: Db, version: number, name: string) => {
  await db
    .prepare(
      `INSERT INTO schema_migrations (version, name, applied_at)
       VALUES (?, ?, ?)
       ON CONFLICT(version) DO UPDATE SET
         name = excluded.name,
         applied_at = excluded.applied_at`
    )
    .bind(version, name, Date.now())
    .run();
};

const applyV1 = async (db: Db) => {
  await runSafe(db, 'ALTER TABLE article_feedback ADD COLUMN feed_id TEXT');
  await runSafe(db, 'CREATE INDEX IF NOT EXISTS idx_article_feedback_feed ON article_feedback(feed_id)');
  await runSafe(
    db,
    `CREATE TABLE IF NOT EXISTS article_reactions (
      id TEXT PRIMARY KEY,
      article_id TEXT NOT NULL UNIQUE,
      feed_id TEXT NOT NULL,
      value INTEGER NOT NULL CHECK (value IN (-1, 1)),
      created_at INTEGER NOT NULL,
      FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE,
      FOREIGN KEY(feed_id) REFERENCES feeds(id) ON DELETE CASCADE
    )`
  );
  await runSafe(db, 'CREATE INDEX IF NOT EXISTS idx_article_reactions_feed ON article_reactions(feed_id)');
  await runSafe(db, 'ALTER TABLE articles ADD COLUMN image_url TEXT');
  await runSafe(db, 'ALTER TABLE jobs ADD COLUMN provider TEXT');
  await runSafe(db, 'ALTER TABLE jobs ADD COLUMN model TEXT');
  await runSafe(
    db,
    `CREATE TABLE IF NOT EXISTS article_score_overrides (
      article_id TEXT PRIMARY KEY,
      score INTEGER NOT NULL CHECK (score >= 1 AND score <= 5),
      comment TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE
    )`
  );
  await runSafe(
    db,
    `CREATE TABLE IF NOT EXISTS article_read_state (
      article_id TEXT PRIMARY KEY,
      is_read INTEGER NOT NULL CHECK (is_read IN (0, 1)),
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE
    )`
  );
  await runSafe(db, 'CREATE INDEX IF NOT EXISTS idx_article_read_state_updated ON article_read_state(updated_at)');
  await runSafe(
    db,
    `CREATE TABLE IF NOT EXISTS article_key_points (
      id TEXT PRIMARY KEY,
      article_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      key_points_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      token_usage_json TEXT,
      prompt_version TEXT,
      FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE
    )`
  );
  await runSafe(db, 'CREATE INDEX IF NOT EXISTS idx_article_key_points_article ON article_key_points(article_id)');
  await runSafe(
    db,
    `CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      name_normalized TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE,
      color TEXT,
      description TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`
  );
  await runSafe(
    db,
    `CREATE TABLE IF NOT EXISTS article_tags (
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
    )`
  );
  await runSafe(db, 'CREATE INDEX IF NOT EXISTS idx_article_tags_article ON article_tags(article_id)');
  await runSafe(db, 'CREATE INDEX IF NOT EXISTS idx_article_tags_tag ON article_tags(tag_id)');
  await runSafe(db, 'CREATE INDEX IF NOT EXISTS idx_tags_updated ON tags(updated_at)');
  await runSafe(
    db,
    `INSERT OR IGNORE INTO article_score_overrides (article_id, score, comment, created_at, updated_at)
     SELECT af.article_id, af.rating, af.comment, af.created_at, af.created_at
     FROM article_feedback af
     JOIN (
       SELECT article_id, MAX(created_at) as max_created_at
       FROM article_feedback
       GROUP BY article_id
     ) latest
       ON latest.article_id = af.article_id
      AND latest.max_created_at = af.created_at
     WHERE af.rating BETWEEN 1 AND 5`
  );
  const futureCutoff = Date.now() + MAX_PUBLISHED_FUTURE_MS;
  await runSafe(
    db,
    'UPDATE articles SET published_at = fetched_at WHERE published_at IS NOT NULL AND fetched_at IS NOT NULL AND published_at > ?',
    [futureCutoff]
  );
  await runSafe(
    db,
    'UPDATE article_sources SET published_at = ? WHERE published_at IS NOT NULL AND published_at > ?',
    [Date.now(), futureCutoff]
  );
  await runSafe(
    db,
    `UPDATE article_feedback
     SET feed_id = (
       SELECT src.feed_id
       FROM article_sources src
       WHERE src.article_id = article_feedback.article_id
       ORDER BY src.published_at DESC NULLS LAST
       LIMIT 1
     )
     WHERE feed_id IS NULL`
  );
  await runSafe(
    db,
    `INSERT OR IGNORE INTO article_reactions (id, article_id, feed_id, value, created_at)
     SELECT lower(hex(randomblob(16))), af.article_id, af.feed_id,
       CASE
         WHEN af.rating >= 4 THEN 1
         WHEN af.rating <= 2 THEN -1
       END as value,
       af.created_at
     FROM article_feedback af
     JOIN (
       SELECT article_id, MAX(created_at) as max_created_at
       FROM article_feedback
       WHERE feed_id IS NOT NULL
       GROUP BY article_id
     ) latest
       ON latest.article_id = af.article_id
      AND latest.max_created_at = af.created_at
     WHERE af.feed_id IS NOT NULL
       AND (af.rating >= 4 OR af.rating <= 2)`
  );
};

const applyV2 = async (db: Db) => {
  await runSafe(db, 'ALTER TABLE jobs ADD COLUMN priority INTEGER NOT NULL DEFAULT 100');
  await runSafe(db, 'ALTER TABLE jobs ADD COLUMN locked_by TEXT');
  await runSafe(db, 'ALTER TABLE jobs ADD COLUMN locked_at INTEGER');
  await runSafe(db, 'ALTER TABLE jobs ADD COLUMN lease_expires_at INTEGER');
  await runSafe(db, 'ALTER TABLE jobs ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0');
  await runSafe(db, 'ALTER TABLE jobs ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0');
  await runSafe(db, 'CREATE INDEX IF NOT EXISTS idx_jobs_lease ON jobs(status, lease_expires_at)');
  await runSafe(db, 'CREATE INDEX IF NOT EXISTS idx_jobs_priority ON jobs(status, priority, run_after)');
  await runSafe(
    db,
    `UPDATE jobs
     SET created_at = CASE WHEN created_at = 0 THEN run_after ELSE created_at END,
         updated_at = CASE WHEN updated_at = 0 THEN run_after ELSE updated_at END`
  );

  await runSafe(db, 'ALTER TABLE provider_keys ADD COLUMN key_version INTEGER NOT NULL DEFAULT 1');

  await runSafe(
    db,
    `CREATE TABLE IF NOT EXISTS pull_runs (
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
    )`
  );
  await runSafe(db, 'CREATE INDEX IF NOT EXISTS idx_pull_runs_status ON pull_runs(status, created_at)');

  await runSafe(
    db,
    `CREATE TABLE IF NOT EXISTS job_runs (
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
    )`
  );
  await runSafe(db, 'CREATE INDEX IF NOT EXISTS idx_job_runs_job ON job_runs(job_id, started_at)');

  await runSafe(
    db,
    `CREATE TABLE IF NOT EXISTS auth_attempts (
      id TEXT PRIMARY KEY,
      identifier TEXT NOT NULL UNIQUE,
      failed_count INTEGER NOT NULL DEFAULT 0,
      first_failed_at INTEGER,
      last_failed_at INTEGER,
      blocked_until INTEGER,
      updated_at INTEGER NOT NULL
    )`
  );
  await runSafe(db, 'CREATE INDEX IF NOT EXISTS idx_auth_attempts_identifier ON auth_attempts(identifier)');

  await runSafe(
    db,
    `CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      target TEXT,
      metadata_json TEXT,
      request_id TEXT,
      created_at INTEGER NOT NULL
    )`
  );
  await runSafe(db, 'CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at)');
};

export async function ensureSchema(db: Db) {
  if (schemaReady) return;
  if (schemaInitPromise) return schemaInitPromise;

  schemaInitPromise = (async () => {
    await ensureMigrationsTable(db);
    const currentVersion = await getAppliedVersion(db);
    if (currentVersion < 1) {
      await applyV1(db);
      await markVersionApplied(db, 1, 'v1_baseline');
    }
    if (currentVersion < 2) {
      await applyV2(db);
      await markVersionApplied(db, 2, 'v2_prod_hardening');
    }
    schemaReady = true;
  })();

  try {
    await schemaInitPromise;
  } finally {
    schemaInitPromise = null;
  }
}

export async function getSchemaVersion(db: Db) {
  await ensureMigrationsTable(db);
  return getAppliedVersion(db);
}

const tableExists = async (db: Db, tableName: string) => {
  const row = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
    .bind(tableName)
    .first<{ name: string }>();
  return Boolean(row?.name);
};

const columnExists = async (db: Db, tableName: string, columnName: string) => {
  const rows = await db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all<{ name: string }>();
  return (rows.results ?? []).some((row) => row.name === columnName);
};

const assertRequiredV2Objects = async (db: Db) => {
  const requiredTables = ['pull_runs', 'job_runs', 'auth_attempts', 'audit_log'];
  for (const tableName of requiredTables) {
    if (!(await tableExists(db, tableName))) {
      throw new Error(`Missing required table: ${tableName}`);
    }
  }

  const requiredJobColumns = ['priority', 'locked_by', 'locked_at', 'lease_expires_at', 'created_at', 'updated_at'];
  for (const columnName of requiredJobColumns) {
    if (!(await columnExists(db, 'jobs', columnName))) {
      throw new Error(`Missing required jobs column: ${columnName}`);
    }
  }

  if (!(await columnExists(db, 'provider_keys', 'key_version'))) {
    throw new Error('Missing required provider_keys column: key_version');
  }
};

export async function assertSchemaVersion(db: Db, expected = EXPECTED_SCHEMA_VERSION) {
  const version = await getSchemaVersion(db);
  if (version < expected) {
    throw new Error(
      `Database schema version ${version} is behind expected version ${expected}. Run migrations before starting the app.`
    );
  }
  if (expected >= 2) {
    await assertRequiredV2Objects(db);
  }
  return version;
}
