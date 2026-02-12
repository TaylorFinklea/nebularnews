import type { Db } from './db';

let schemaReady = false;
let schemaInitPromise: Promise<void> | null = null;

const runSafe = async (db: Db, sql: string) => {
  try {
    await db.prepare(sql).run();
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
    schemaReady = true;
  })();

  try {
    await schemaInitPromise;
  } finally {
    schemaInitPromise = null;
  }
}
