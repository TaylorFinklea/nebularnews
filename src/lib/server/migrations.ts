import type { Db } from './db';
import { STARTER_CANONICAL_TAGS } from './tagging/taxonomy';

let schemaReady = false;
let schemaInitPromise: Promise<void> | null = null;

const MAX_PUBLISHED_FUTURE_MS = 1000 * 60 * 60 * 24;
export const EXPECTED_SCHEMA_VERSION = 17;

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

const applyV12 = async (db: Db) => {
  await runSafe(
    db,
    `CREATE TABLE IF NOT EXISTS oauth_clients (
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
    )`
  );
  await runSafe(
    db,
    `CREATE TABLE IF NOT EXISTS oauth_consents (
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
    )`
  );
  await runSafe(
    db,
    `CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
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
    )`
  );
  await runSafe(
    db,
    `CREATE TABLE IF NOT EXISTS oauth_access_tokens (
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
    )`
  );
  await runSafe(
    db,
    `CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
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
    )`
  );
  await runSafe(db, 'CREATE INDEX IF NOT EXISTS idx_oauth_consents_client ON oauth_consents(client_id)');
  await runSafe(db, 'CREATE INDEX IF NOT EXISTS idx_oauth_consents_revoked ON oauth_consents(revoked_at)');
  await runSafe(db, 'CREATE INDEX IF NOT EXISTS idx_oauth_codes_client ON oauth_authorization_codes(client_id)');
  await runSafe(db, 'CREATE INDEX IF NOT EXISTS idx_oauth_codes_expires ON oauth_authorization_codes(expires_at)');
  await runSafe(db, 'CREATE INDEX IF NOT EXISTS idx_oauth_access_tokens_client ON oauth_access_tokens(client_id)');
  await runSafe(db, 'CREATE INDEX IF NOT EXISTS idx_oauth_access_tokens_expires ON oauth_access_tokens(expires_at)');
  await runSafe(db, 'CREATE INDEX IF NOT EXISTS idx_oauth_access_tokens_revoked ON oauth_access_tokens(revoked_at)');
  await runSafe(db, 'CREATE INDEX IF NOT EXISTS idx_oauth_access_tokens_last_used ON oauth_access_tokens(last_used_at)');
  await runSafe(db, 'CREATE INDEX IF NOT EXISTS idx_oauth_refresh_tokens_client ON oauth_refresh_tokens(client_id)');
  await runSafe(db, 'CREATE INDEX IF NOT EXISTS idx_oauth_refresh_tokens_expires ON oauth_refresh_tokens(expires_at)');
  await runSafe(db, 'CREATE INDEX IF NOT EXISTS idx_oauth_refresh_tokens_revoked ON oauth_refresh_tokens(revoked_at)');
  await runSafe(db, 'CREATE INDEX IF NOT EXISTS idx_oauth_refresh_tokens_last_used ON oauth_refresh_tokens(last_used_at)');
};

const applyV13 = async (db: Db) => {
  if (!(await columnExists(db, 'article_read_state', 'saved_at'))) {
    await runSafe(db, 'ALTER TABLE article_read_state ADD COLUMN saved_at INTEGER');
  }
  await runSafe(db, 'CREATE INDEX IF NOT EXISTS idx_article_read_state_saved ON article_read_state(saved_at)');
};

const applyV14 = async (db: Db) => {
  // Article extraction metadata
  await runSafe(db, 'ALTER TABLE articles ADD COLUMN extraction_method TEXT');
  await runSafe(db, 'ALTER TABLE articles ADD COLUMN extraction_quality REAL');

  // Feed extraction stats for auto-learning
  await runSafe(db, 'ALTER TABLE feeds ADD COLUMN extraction_success_count INTEGER NOT NULL DEFAULT 0');
  await runSafe(db, 'ALTER TABLE feeds ADD COLUMN extraction_fail_count INTEGER NOT NULL DEFAULT 0');
  await runSafe(db, 'ALTER TABLE feeds ADD COLUMN browser_scrape_enabled INTEGER NOT NULL DEFAULT 0');

  await runSafe(
    db,
    'CREATE INDEX IF NOT EXISTS idx_articles_extraction_quality ON articles(extraction_quality, extraction_method)'
  );

  // Backfill: estimate quality from word_count for existing articles
  await runSafe(
    db,
    `UPDATE articles
     SET extraction_method = 'readability',
         extraction_quality = MIN(1.0, CAST(word_count AS REAL) / 800.0)
     WHERE extraction_method IS NULL AND word_count IS NOT NULL AND word_count >= 200`
  );
  await runSafe(
    db,
    `UPDATE articles
     SET extraction_method = 'feed_only',
         extraction_quality = 0.2
     WHERE extraction_method IS NULL`
  );
};

const applyV15 = async (db: Db) => {
  await runSafe(
    db,
    `CREATE TABLE IF NOT EXISTS chat_threads (
      id TEXT PRIMARY KEY,
      article_id TEXT UNIQUE,
      title TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE
    )`
  );
  await runSafe(
    db,
    `CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      token_count INTEGER,
      provider TEXT,
      model TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE
    )`
  );
  await runSafe(db, 'CREATE INDEX IF NOT EXISTS idx_chat_threads_article ON chat_threads(article_id)');
  await runSafe(db, 'CREATE INDEX IF NOT EXISTS idx_chat_messages_thread ON chat_messages(thread_id, created_at)');
};

const applyV16 = async (db: Db) => {
  await runSafe(
    db,
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      display_name TEXT,
      auth_provider TEXT NOT NULL DEFAULT 'local',
      external_id TEXT UNIQUE,
      role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_login_at INTEGER
    )`
  );
  await runSafe(db, 'CREATE INDEX IF NOT EXISTS idx_users_external ON users(external_id)');
  await runSafe(db, 'CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)');

  // Bootstrap the admin user so existing sessions (userId='admin') resolve to a real row
  const timestamp = Date.now();
  await runSafe(
    db,
    `INSERT OR IGNORE INTO users (id, email, display_name, auth_provider, role, created_at, updated_at)
     VALUES ('admin', NULL, 'Admin', 'local', 'admin', ?, ?)`,
    [timestamp, timestamp]
  );
};

const SYSTEM_SETTINGS_KEYS = [
  'scheduler_jobs_interval_min', 'scheduler_poll_interval_min',
  'scheduler_pull_slices_per_tick', 'scheduler_pull_slice_budget_ms',
  'scheduler_job_budget_idle_ms', 'scheduler_job_budget_while_pull_ms',
  'scheduler_auto_queue_today_missing',
  'retention_days', 'retention_delete_days', 'retention_mode',
  'max_feeds_per_poll', 'max_items_per_poll',
  'job_processor_batch_size',
  'events_poll_ms', 'dashboard_refresh_min_ms',
  'initial_feed_lookback_days',
  'ingest_provider', 'ingest_model', 'ingest_reasoning_effort',
  'chat_provider', 'chat_model', 'chat_reasoning_effort',
  'default_provider', 'default_model', 'reasoning_effort',
  'lane_summaries', 'lane_scoring', 'lane_profile_refresh', 'lane_key_points', 'lane_auto_tagging',
  'score_system_prompt', 'score_user_prompt_template',
  'scoring_method', 'scoring_ai_enhancement_threshold', 'scoring_learning_rate',
  'browser_scraping_enabled', 'browser_scrape_provider', 'browser_scrape_api_url'
];

const applyV17 = async (db: Db) => {
  const timestamp = Date.now();

  // 1a. user_feed_subscriptions
  await runSafe(
    db,
    `CREATE TABLE IF NOT EXISTS user_feed_subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      feed_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(user_id, feed_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(feed_id) REFERENCES feeds(id) ON DELETE CASCADE
    )`
  );
  await runSafe(db, 'CREATE INDEX IF NOT EXISTS idx_ufs_user ON user_feed_subscriptions(user_id)');
  await runSafe(db, 'CREATE INDEX IF NOT EXISTS idx_ufs_feed ON user_feed_subscriptions(feed_id)');
  await runSafe(
    db,
    `INSERT OR IGNORE INTO user_feed_subscriptions (id, user_id, feed_id, created_at)
     SELECT ('ufs-' || id), 'admin', id, COALESCE(last_polled_at, ?)
     FROM feeds`,
    [timestamp]
  );

  // 1b. Recreate article_read_state with user_id in PK
  await runSafe(
    db,
    `CREATE TABLE IF NOT EXISTS article_read_state_v2 (
      user_id TEXT NOT NULL,
      article_id TEXT NOT NULL,
      is_read INTEGER NOT NULL CHECK (is_read IN (0, 1)),
      updated_at INTEGER NOT NULL,
      saved_at INTEGER,
      PRIMARY KEY (user_id, article_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE
    )`
  );
  await runSafe(
    db,
    `INSERT OR IGNORE INTO article_read_state_v2 (user_id, article_id, is_read, updated_at, saved_at)
     SELECT 'admin', article_id, is_read, updated_at, saved_at FROM article_read_state`
  );
  await runSafe(db, 'DROP TABLE IF EXISTS article_read_state');
  await runSafe(db, 'ALTER TABLE article_read_state_v2 RENAME TO article_read_state');
  await runSafe(db, 'CREATE INDEX IF NOT EXISTS idx_article_read_state_user ON article_read_state(user_id)');
  await runSafe(db, 'CREATE INDEX IF NOT EXISTS idx_article_read_state_updated ON article_read_state(updated_at)');
  await runSafe(db, 'CREATE INDEX IF NOT EXISTS idx_article_read_state_saved ON article_read_state(saved_at)');

  // 1b. Recreate article_reactions with user_id in UNIQUE
  await runSafe(
    db,
    `CREATE TABLE IF NOT EXISTS article_reactions_v2 (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      article_id TEXT NOT NULL,
      feed_id TEXT NOT NULL,
      value INTEGER NOT NULL CHECK (value IN (-1, 1)),
      created_at INTEGER NOT NULL,
      UNIQUE(user_id, article_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE,
      FOREIGN KEY(feed_id) REFERENCES feeds(id) ON DELETE CASCADE
    )`
  );
  await runSafe(
    db,
    `INSERT OR IGNORE INTO article_reactions_v2 (id, user_id, article_id, feed_id, value, created_at)
     SELECT id, 'admin', article_id, feed_id, value, created_at FROM article_reactions`
  );
  await runSafe(db, 'DROP TABLE IF EXISTS article_reactions');
  await runSafe(db, 'ALTER TABLE article_reactions_v2 RENAME TO article_reactions');
  await runSafe(db, 'CREATE INDEX IF NOT EXISTS idx_article_reactions_user ON article_reactions(user_id)');
  await runSafe(db, 'CREATE INDEX IF NOT EXISTS idx_article_reactions_feed ON article_reactions(feed_id)');

  // 1b. Recreate article_reaction_reasons with user_id in PK
  await runSafe(
    db,
    `CREATE TABLE IF NOT EXISTS article_reaction_reasons_v2 (
      user_id TEXT NOT NULL,
      article_id TEXT NOT NULL,
      reason_code TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, article_id, reason_code),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE
    )`
  );
  await runSafe(
    db,
    `INSERT OR IGNORE INTO article_reaction_reasons_v2 (user_id, article_id, reason_code, created_at)
     SELECT 'admin', article_id, reason_code, created_at FROM article_reaction_reasons`
  );
  await runSafe(db, 'DROP TABLE IF EXISTS article_reaction_reasons');
  await runSafe(db, 'ALTER TABLE article_reaction_reasons_v2 RENAME TO article_reaction_reasons');
  await runSafe(db, 'CREATE INDEX IF NOT EXISTS idx_article_reaction_reasons_code ON article_reaction_reasons(reason_code)');

  // 1b. Recreate article_tags with user_id in UNIQUE
  await runSafe(
    db,
    `CREATE TABLE IF NOT EXISTS article_tags_v2 (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      article_id TEXT NOT NULL,
      tag_id TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'ai', 'system')),
      confidence REAL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(user_id, article_id, tag_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE,
      FOREIGN KEY(tag_id) REFERENCES tags(id) ON DELETE CASCADE
    )`
  );
  await runSafe(
    db,
    `INSERT OR IGNORE INTO article_tags_v2 (id, user_id, article_id, tag_id, source, confidence, created_at, updated_at)
     SELECT id, 'admin', article_id, tag_id, source, confidence, created_at, updated_at FROM article_tags`
  );
  await runSafe(db, 'DROP TABLE IF EXISTS article_tags');
  await runSafe(db, 'ALTER TABLE article_tags_v2 RENAME TO article_tags');
  await runSafe(db, 'CREATE INDEX IF NOT EXISTS idx_article_tags_article ON article_tags(article_id)');
  await runSafe(db, 'CREATE INDEX IF NOT EXISTS idx_article_tags_tag ON article_tags(tag_id)');
  await runSafe(db, 'CREATE INDEX IF NOT EXISTS idx_article_tags_user ON article_tags(user_id)');
  await runSafe(db, 'CREATE INDEX IF NOT EXISTS idx_tags_updated ON tags(updated_at)');

  // 1b. Recreate article_tag_suggestion_dismissals with user_id in PK
  await runSafe(
    db,
    `CREATE TABLE IF NOT EXISTS article_tag_suggestion_dismissals_v2 (
      user_id TEXT NOT NULL,
      article_id TEXT NOT NULL,
      name_normalized TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY(user_id, article_id, name_normalized),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE
    )`
  );
  await runSafe(
    db,
    `INSERT OR IGNORE INTO article_tag_suggestion_dismissals_v2 (user_id, article_id, name_normalized, created_at)
     SELECT 'admin', article_id, name_normalized, created_at FROM article_tag_suggestion_dismissals`
  );
  await runSafe(db, 'DROP TABLE IF EXISTS article_tag_suggestion_dismissals');
  await runSafe(db, 'ALTER TABLE article_tag_suggestion_dismissals_v2 RENAME TO article_tag_suggestion_dismissals');
  await runSafe(db, 'CREATE INDEX IF NOT EXISTS idx_article_tag_dismissals_article ON article_tag_suggestion_dismissals(article_id)');

  // 1b. Recreate article_score_overrides with user_id in PK
  await runSafe(
    db,
    `CREATE TABLE IF NOT EXISTS article_score_overrides_v2 (
      user_id TEXT NOT NULL,
      article_id TEXT NOT NULL,
      score INTEGER NOT NULL CHECK (score >= 1 AND score <= 5),
      comment TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, article_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE
    )`
  );
  await runSafe(
    db,
    `INSERT OR IGNORE INTO article_score_overrides_v2 (user_id, article_id, score, comment, created_at, updated_at)
     SELECT 'admin', article_id, score, comment, created_at, updated_at FROM article_score_overrides`
  );
  await runSafe(db, 'DROP TABLE IF EXISTS article_score_overrides');
  await runSafe(db, 'ALTER TABLE article_score_overrides_v2 RENAME TO article_score_overrides');

  // 1b. Recreate settings with user_id in UNIQUE
  await runSafe(
    db,
    `CREATE TABLE IF NOT EXISTS settings_v2 (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'admin',
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(user_id, key)
    )`
  );
  await runSafe(
    db,
    `INSERT OR IGNORE INTO settings_v2 (id, user_id, key, value, updated_at)
     SELECT id, 'admin', key, value, updated_at FROM settings`
  );
  await runSafe(db, 'DROP TABLE IF EXISTS settings');
  await runSafe(db, 'ALTER TABLE settings_v2 RENAME TO settings');

  // Reclassify system settings
  const placeholders = SYSTEM_SETTINGS_KEYS.map(() => '?').join(',');
  await runSafe(
    db,
    `UPDATE settings SET user_id = '__system__' WHERE key IN (${placeholders})`,
    SYSTEM_SETTINGS_KEYS
  );

  // 1b. Recreate chat_threads with user_id in UNIQUE
  await runSafe(
    db,
    `CREATE TABLE IF NOT EXISTS chat_threads_v2 (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      article_id TEXT,
      title TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(user_id, article_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE
    )`
  );
  await runSafe(
    db,
    `INSERT OR IGNORE INTO chat_threads_v2 (id, user_id, article_id, title, created_at, updated_at)
     SELECT id, 'admin', article_id, title, created_at, updated_at FROM chat_threads`
  );
  await runSafe(db, 'DROP TABLE IF EXISTS chat_threads');
  await runSafe(db, 'ALTER TABLE chat_threads_v2 RENAME TO chat_threads');
  await runSafe(db, 'CREATE INDEX IF NOT EXISTS idx_chat_threads_article ON chat_threads(article_id)');
  await runSafe(db, 'CREATE INDEX IF NOT EXISTS idx_chat_threads_user ON chat_threads(user_id)');

  // 1c. ALTER TABLE for remaining tables
  await runSafe(db, "ALTER TABLE article_feedback ADD COLUMN user_id TEXT NOT NULL DEFAULT 'admin'");
  await runSafe(db, "ALTER TABLE article_tag_suggestions ADD COLUMN user_id TEXT NOT NULL DEFAULT 'admin'");
  await runSafe(db, "ALTER TABLE news_brief_editions ADD COLUMN user_id TEXT NOT NULL DEFAULT 'admin'");
  await runSafe(db, "ALTER TABLE device_tokens ADD COLUMN user_id TEXT NOT NULL DEFAULT 'admin'");
  await runSafe(db, "ALTER TABLE preference_profile ADD COLUMN user_id TEXT NOT NULL DEFAULT 'admin'");

  // Add user_id to topic/author affinities for per-user learning
  await runSafe(db, "ALTER TABLE topic_affinities ADD COLUMN user_id TEXT NOT NULL DEFAULT 'admin'");
  await runSafe(db, "ALTER TABLE author_affinities ADD COLUMN user_id TEXT NOT NULL DEFAULT 'admin'");

  // 1d. Additional indexes
  await runSafe(db, 'CREATE INDEX IF NOT EXISTS idx_article_feedback_user ON article_feedback(user_id)');
  await runSafe(db, 'CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON device_tokens(user_id)');
  await runSafe(db, 'CREATE INDEX IF NOT EXISTS idx_news_brief_editions_user ON news_brief_editions(user_id)');
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
    if (currentVersion < 12) {
      await applyV12(db);
      await markVersionApplied(db, 12, 'v12_public_mcp_oauth');
    }
    if (currentVersion < 13) {
      await applyV13(db);
      await markVersionApplied(db, 13, 'v13_reading_list_saved_at');
    }
    if (currentVersion < 14) {
      await applyV14(db);
      await markVersionApplied(db, 14, 'v14_content_quality_tracking');
    }
    if (currentVersion < 15) {
      await applyV15(db);
      await markVersionApplied(db, 15, 'v15_article_chat');
    }
    if (currentVersion < 16) {
      await applyV16(db);
      await markVersionApplied(db, 16, 'v16_users_table');
    }
    if (currentVersion < 17) {
      await applyV17(db);
      await markVersionApplied(db, 17, 'v17_per_user_data_isolation');
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

const assertRequiredV12Objects = async (db: Db) => {
  const requiredTables = [
    'oauth_clients',
    'oauth_consents',
    'oauth_authorization_codes',
    'oauth_access_tokens',
    'oauth_refresh_tokens'
  ];
  for (const tableName of requiredTables) {
    if (!(await tableExists(db, tableName))) {
      throw new Error(`Missing required table: ${tableName}`);
    }
  }
};

const assertRequiredV14Objects = async (db: Db) => {
  const requiredArticleColumns = ['extraction_method', 'extraction_quality'];
  for (const columnName of requiredArticleColumns) {
    if (!(await columnExists(db, 'articles', columnName))) {
      throw new Error(`Missing required articles column: ${columnName}`);
    }
  }
  const requiredFeedColumns = ['extraction_success_count', 'extraction_fail_count', 'browser_scrape_enabled'];
  for (const columnName of requiredFeedColumns) {
    if (!(await columnExists(db, 'feeds', columnName))) {
      throw new Error(`Missing required feeds column: ${columnName}`);
    }
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
  if (expected >= 12) {
    await assertRequiredV12Objects(db);
  }
  if (expected >= 14) {
    await assertRequiredV14Objects(db);
  }
  if (expected >= 15) {
    await assertRequiredV15Objects(db);
  }
  if (expected >= 16) {
    await assertRequiredV16Objects(db);
  }
  if (expected >= 17) {
    await assertRequiredV17Objects(db);
  }
  return version;
}

const assertRequiredV15Objects = async (db: Db) => {
  for (const tableName of ['chat_threads', 'chat_messages']) {
    if (!(await tableExists(db, tableName))) {
      throw new Error(`Missing required table: ${tableName}`);
    }
  }
};

const assertRequiredV16Objects = async (db: Db) => {
  if (!(await tableExists(db, 'users'))) {
    throw new Error('Missing required table: users');
  }
};

const assertRequiredV17Objects = async (db: Db) => {
  if (!(await tableExists(db, 'user_feed_subscriptions'))) {
    throw new Error('Missing required table: user_feed_subscriptions');
  }
};
