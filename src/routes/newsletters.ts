import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import type { AppEnv } from '../index';
import { dbGet, dbAll, dbRun } from '../db/helpers';

export const newsletterRoutes = new Hono<AppEnv>();

const EMAIL_DOMAIN = 'read.nebularnews.com';

// ---------------------------------------------------------------------------
// GET /newsletters/address — get or create the user's ingest email address
// ---------------------------------------------------------------------------

newsletterRoutes.get('/newsletters/address', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;

  let row = await dbGet<{ token: string }>(
    db,
    `SELECT token FROM email_ingest_tokens WHERE user_id = ?`,
    [userId],
  );

  if (!row) {
    // Generate a new token.
    const token = nanoid(12);
    await dbRun(
      db,
      `INSERT INTO email_ingest_tokens (id, user_id, token, created_at) VALUES (?, ?, ?, ?)`,
      [nanoid(), userId, token, Date.now()],
    );
    row = { token };
  }

  return c.json({
    ok: true,
    data: { address: `${row.token}@${EMAIL_DOMAIN}`, token: row.token },
  });
});

// ---------------------------------------------------------------------------
// POST /newsletters/address/regenerate — generate a new token
// ---------------------------------------------------------------------------

newsletterRoutes.post('/newsletters/address/regenerate', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;

  // Delete old token.
  await dbRun(db, `DELETE FROM email_ingest_tokens WHERE user_id = ?`, [userId]);

  // Create new one.
  const token = nanoid(12);
  await dbRun(
    db,
    `INSERT INTO email_ingest_tokens (id, user_id, token, created_at) VALUES (?, ?, ?, ?)`,
    [nanoid(), userId, token, Date.now()],
  );

  return c.json({
    ok: true,
    data: { address: `${token}@${EMAIL_DOMAIN}`, token },
  });
});

// ---------------------------------------------------------------------------
// GET /newsletters/feeds — list newsletter feeds only
// ---------------------------------------------------------------------------

newsletterRoutes.get('/newsletters/feeds', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;

  const feeds = await dbAll<{
    id: string; title: string; url: string; article_count: number;
  }>(
    db,
    `SELECT f.id, f.title, f.url,
            (SELECT COUNT(*) FROM article_sources asrc WHERE asrc.feed_id = f.id) AS article_count
     FROM feeds f
     JOIN user_feed_subscriptions ufs ON ufs.feed_id = f.id AND ufs.user_id = ?
     WHERE f.feed_type = 'email_newsletter'
     ORDER BY f.title ASC`,
    [userId],
  );

  return c.json({ ok: true, data: feeds });
});
