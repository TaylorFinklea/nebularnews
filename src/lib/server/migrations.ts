import type { Db } from './db';

let schemaReady = false;
let schemaInitPromise: Promise<void> | null = null;

const MAX_PUBLISHED_FUTURE_MS = 1000 * 60 * 60 * 24;

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

export async function ensureSchema(db: Db) {
  if (schemaReady) return;
  if (schemaInitPromise) return schemaInitPromise;

  schemaInitPromise = (async () => {
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
    await runSafe(db, 'ALTER TABLE jobs ADD COLUMN provider TEXT');
    await runSafe(db, 'ALTER TABLE jobs ADD COLUMN model TEXT');
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
    schemaReady = true;
  })();

  try {
    await schemaInitPromise;
  } finally {
    schemaInitPromise = null;
  }
}
