import type { Db } from './db';
import { STARTER_CANONICAL_TAGS } from './tagging/taxonomy';

let schemaReady = false;
let schemaInitPromise: Promise<void> | null = null;

const MAX_PUBLISHED_FUTURE_MS = 1000 * 60 * 60 * 24;
export const EXPECTED_SCHEMA_VERSION = 11;

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

const applyV3 = async (db: Db) => {
  await runSafe(
    db,
    'CREATE INDEX IF NOT EXISTS idx_article_summaries_article_created ON article_summaries(article_id, created_at DESC)'
  );
  await runSafe(
    db,
    'CREATE INDEX IF NOT EXISTS idx_article_scores_article_created ON article_scores(article_id, created_at DESC)'
  );
  await runSafe(
    db,
    'CREATE INDEX IF NOT EXISTS idx_article_key_points_article_created ON article_key_points(article_id, created_at DESC)'
  );
};

const applyV4 = async (db: Db) => {
  await runSafe(db, 'ALTER TABLE articles ADD COLUMN image_status TEXT');
  await runSafe(db, 'ALTER TABLE articles ADD COLUMN image_checked_at INTEGER');
  await runSafe(db, "UPDATE articles SET image_status = 'found' WHERE image_url IS NOT NULL AND image_status IS NULL");
  await runSafe(db, "UPDATE articles SET image_status = 'pending' WHERE image_url IS NULL AND image_status IS NULL");
  await runSafe(db, 'CREATE INDEX IF NOT EXISTS idx_articles_image_status ON articles(image_status, image_checked_at)');
};

const applyV5 = async (db: Db) => {
  await runSafe(
    db,
    `CREATE TABLE IF NOT EXISTS article_tag_suggestions (
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
    )`
  );
  await runSafe(
    db,
    `CREATE TABLE IF NOT EXISTS article_tag_suggestion_dismissals (
      article_id TEXT NOT NULL,
      name_normalized TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY(article_id, name_normalized),
      FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE
    )`
  );
  await runSafe(
    db,
    'CREATE INDEX IF NOT EXISTS idx_article_tag_suggestions_article ON article_tag_suggestions(article_id, updated_at DESC)'
  );
  await runSafe(
    db,
    'CREATE INDEX IF NOT EXISTS idx_article_tag_suggestions_name ON article_tag_suggestions(name_normalized)'
  );
  await runSafe(
    db,
    'CREATE INDEX IF NOT EXISTS idx_article_tag_dismissals_article ON article_tag_suggestion_dismissals(article_id)'
  );
  await runSafe(db, "DELETE FROM article_tags WHERE source = 'ai'");
};

const applyV6 = async (db: Db) => {
  // Signal weights — stores learned weights per signal
  await runSafe(
    db,
    `CREATE TABLE IF NOT EXISTS signal_weights (
      signal_name TEXT PRIMARY KEY,
      weight REAL NOT NULL DEFAULT 1.0,
      sample_count INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    )`
  );

  // Article signal scores — per-article signal breakdown for transparency
  await runSafe(
    db,
    `CREATE TABLE IF NOT EXISTS article_signal_scores (
      id TEXT PRIMARY KEY,
      article_id TEXT NOT NULL,
      signal_name TEXT NOT NULL,
      raw_value REAL NOT NULL,
      normalized_value REAL NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(article_id, signal_name),
      FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE
    )`
  );
  await runSafe(
    db,
    'CREATE INDEX IF NOT EXISTS idx_article_signal_scores_article ON article_signal_scores(article_id)'
  );

  // Topic affinities — tracks user preference per tag/topic
  await runSafe(
    db,
    `CREATE TABLE IF NOT EXISTS topic_affinities (
      tag_name_normalized TEXT PRIMARY KEY,
      affinity REAL NOT NULL DEFAULT 0.0,
      interaction_count INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    )`
  );

  // Author affinities — tracks user preference per author
  await runSafe(
    db,
    `CREATE TABLE IF NOT EXISTS author_affinities (
      author_normalized TEXT PRIMARY KEY,
      affinity REAL NOT NULL DEFAULT 0.0,
      interaction_count INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    )`
  );

  // Add scoring_method to article_scores
  await runSafe(db, "ALTER TABLE article_scores ADD COLUMN scoring_method TEXT NOT NULL DEFAULT 'ai'");

  // Seed default signal weights
  const defaultWeights: [string, number][] = [
    ['topic_affinity', 1.0],
    ['source_reputation', 0.8],
    ['content_freshness', 0.6],
    ['content_depth', 0.5],
    ['author_affinity', 0.7],
    ['tag_match_ratio', 0.9]
  ];
  const ts = Date.now();
  for (const [name, weight] of defaultWeights) {
    await runSafe(
      db,
      'INSERT OR IGNORE INTO signal_weights (signal_name, weight, sample_count, updated_at) VALUES (?, ?, 0, ?)',
      [name, weight, ts]
    );
  }
};

const applyV7 = async (db: Db) => {
  await runSafe(
    db,
    `CREATE TABLE IF NOT EXISTS article_reaction_reasons (
      article_id TEXT NOT NULL,
      reason_code TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (article_id, reason_code),
      FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE
    )`
  );
  await runSafe(
    db,
    'CREATE INDEX IF NOT EXISTS idx_article_reaction_reasons_code ON article_reaction_reasons(reason_code)'
  );
};

const applyV8 = async (db: Db) => {
  await runSafe(
    db,
    "ALTER TABLE article_scores ADD COLUMN score_status TEXT NOT NULL DEFAULT 'ready'"
  );
  await runSafe(db, 'ALTER TABLE article_scores ADD COLUMN confidence REAL');
  await runSafe(db, 'ALTER TABLE article_scores ADD COLUMN preference_confidence REAL');
  await runSafe(db, 'ALTER TABLE article_scores ADD COLUMN weighted_average REAL');
  await runSafe(
    db,
    "UPDATE article_scores SET score_status = 'ready' WHERE score_status IS NULL OR TRIM(score_status) = ''"
  );
};

const rebuildArticleSearchIndex = async (db: Db) => {
  await runSafe(
    db,
    `CREATE VIRTUAL TABLE IF NOT EXISTS article_search USING fts5(
      article_id UNINDEXED,
      title,
      content_text,
      summary_text,
      tokenize = 'porter'
    )`
  );
  await runSafe(db, 'DELETE FROM article_search');
  await runSafe(
    db,
    `INSERT INTO article_search (article_id, title, content_text, summary_text)
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
     FROM articles a`
  );
};

const applyV9 = async (db: Db) => {
  await rebuildArticleSearchIndex(db);
};

const applyV10 = async (db: Db) => {
  await runSafe(
    db,
    `CREATE TABLE IF NOT EXISTS news_brief_editions (
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
    )`
  );
  await runSafe(
    db,
    'CREATE INDEX IF NOT EXISTS idx_news_brief_editions_status_run_after ON news_brief_editions(status, run_after)'
  );
  await runSafe(
    db,
    'CREATE INDEX IF NOT EXISTS idx_news_brief_editions_generated_at ON news_brief_editions(generated_at DESC, scheduled_for DESC)'
  );
};

const applyV11 = async (db: Db) => {
  const timestamp = Date.now();
  for (const tag of STARTER_CANONICAL_TAGS) {
    await runSafe(
      db,
      `INSERT OR IGNORE INTO tags (id, name, name_normalized, slug, color, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)`,
      [tag.id, tag.name, tag.name.toLowerCase(), tag.slug, timestamp, timestamp]
    );
  }
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
    if (currentVersion < 3) {
      await applyV3(db);
      await markVersionApplied(db, 3, 'v3_query_indexes');
    }
    if (currentVersion < 4) {
      await applyV4(db);
      await markVersionApplied(db, 4, 'v4_reliability_budgets');
    }
    if (currentVersion < 5) {
      await applyV5(db);
      await markVersionApplied(db, 5, 'v5_tagging_v2_suggestions');
    }
    if (currentVersion < 6) {
      await applyV6(db);
      await markVersionApplied(db, 6, 'v6_hybrid_scoring');
    }
    if (currentVersion < 7) {
      await applyV7(db);
      await markVersionApplied(db, 7, 'v7_reaction_reason_chips');
    }
    if (currentVersion < 8) {
      await applyV8(db);
      await markVersionApplied(db, 8, 'v8_score_status_metadata');
    }
    if (currentVersion < 9) {
      await applyV9(db);
      await markVersionApplied(db, 9, 'v9_article_search_backfill');
    }
    if (currentVersion < 10) {
      await applyV10(db);
      await markVersionApplied(db, 10, 'v10_news_brief_editions');
    }
    if (currentVersion < 11) {
      await applyV11(db);
      await markVersionApplied(db, 11, 'v11_starter_tag_taxonomy');
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

const assertRequiredV4Objects = async (db: Db) => {
  const requiredArticleColumns = ['image_status', 'image_checked_at'];
  for (const columnName of requiredArticleColumns) {
    if (!(await columnExists(db, 'articles', columnName))) {
      throw new Error(`Missing required articles column: ${columnName}`);
    }
  }
};

const assertRequiredV5Objects = async (db: Db) => {
  const requiredTables = ['article_tag_suggestions', 'article_tag_suggestion_dismissals'];
  for (const tableName of requiredTables) {
    if (!(await tableExists(db, tableName))) {
      throw new Error(`Missing required table: ${tableName}`);
    }
  }
};

const assertRequiredV7Objects = async (db: Db) => {
  if (!(await tableExists(db, 'article_reaction_reasons'))) {
    throw new Error('Missing required table: article_reaction_reasons');
  }
};

const assertRequiredV8Objects = async (db: Db) => {
  const requiredScoreColumns = ['score_status', 'confidence', 'preference_confidence', 'weighted_average'];
  for (const columnName of requiredScoreColumns) {
    if (!(await columnExists(db, 'article_scores', columnName))) {
      throw new Error(`Missing required article_scores column: ${columnName}`);
    }
  }
};

const assertRequiredV9Objects = async (db: Db) => {
  if (!(await tableExists(db, 'article_search'))) {
    throw new Error('Missing required table: article_search');
  }
};

const assertRequiredV10Objects = async (db: Db) => {
  if (!(await tableExists(db, 'news_brief_editions'))) {
    throw new Error('Missing required table: news_brief_editions');
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
  if (expected >= 4) {
    await assertRequiredV4Objects(db);
  }
  if (expected >= 5) {
    await assertRequiredV5Objects(db);
  }
  if (expected >= 7) {
    await assertRequiredV7Objects(db);
  }
  if (expected >= 8) {
    await assertRequiredV8Objects(db);
  }
  if (expected >= 9) {
    await assertRequiredV9Objects(db);
  }
  if (expected >= 10) {
    await assertRequiredV10Objects(db);
  }
  return version;
}
