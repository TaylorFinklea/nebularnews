import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import type { AppEnv } from '../index';
import { dbAll, dbGet, dbRun } from '../db/helpers';

export const collectionRoutes = new Hono<AppEnv>();

interface Collection {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  position: number;
  created_at: number;
  updated_at: number;
}

interface CollectionWithCount extends Collection {
  article_count: number;
}

// GET /collections — list user's collections with article counts
collectionRoutes.get('/collections', async (c) => {
  const userId = c.get('userId');

  const rows = await dbAll<CollectionWithCount>(
    c.env.DB,
    `SELECT c.*, COUNT(ca.id) AS article_count
     FROM collections c
     LEFT JOIN collection_articles ca ON ca.collection_id = c.id
     WHERE c.user_id = ?
     GROUP BY c.id
     ORDER BY c.position, c.created_at`,
    [userId],
  );

  return c.json({ ok: true, data: rows });
});

// POST /collections — create a collection
collectionRoutes.post('/collections', async (c) => {
  const userId = c.get('userId');
  const { name, description, color, icon } = await c.req.json<{
    name: string;
    description?: string;
    color?: string;
    icon?: string;
  }>();

  if (!name?.trim()) {
    return c.json({ ok: false, error: { code: 'invalid_input', message: 'Name is required' } }, 400);
  }

  // Get next position
  const last = await dbGet<{ max_pos: number | null }>(
    c.env.DB,
    `SELECT MAX(position) AS max_pos FROM collections WHERE user_id = ?`,
    [userId],
  );
  const position = (last?.max_pos ?? -1) + 1;

  const id = nanoid();
  const now = Date.now();
  await dbRun(
    c.env.DB,
    `INSERT INTO collections (id, user_id, name, description, color, icon, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, name.trim(), description ?? null, color ?? null, icon ?? null, position, now, now],
  );

  const collection = await dbGet<Collection>(c.env.DB, `SELECT * FROM collections WHERE id = ?`, [id]);
  return c.json({ ok: true, data: { ...collection, article_count: 0 } }, 201);
});

// GET /collections/:id — get collection with its articles
collectionRoutes.get('/collections/:id', async (c) => {
  const userId = c.get('userId');
  const collectionId = c.req.param('id');

  const collection = await dbGet<Collection>(
    c.env.DB,
    `SELECT * FROM collections WHERE id = ? AND user_id = ?`,
    [collectionId, userId],
  );

  if (!collection) {
    return c.json({ ok: false, error: { code: 'not_found', message: 'Collection not found' } }, 404);
  }

  const articles = await dbAll<Record<string, unknown>>(
    c.env.DB,
    `SELECT a.id, a.canonical_url, a.title, a.author, a.published_at, a.fetched_at,
            a.excerpt, a.image_url, a.word_count, a.status,
            ars.is_read, ars.saved_at,
            ascore.score, ascore.label AS score_label, ascore.score_status,
            asum.summary_text AS card_summary_text,
            src.feed_title AS source_name, src.feed_id AS source_feed_id,
            ca.position AS collection_position, ca.added_at
     FROM collection_articles ca
     JOIN articles a ON a.id = ca.article_id
     LEFT JOIN article_read_state ars ON ars.article_id = a.id AND ars.user_id = ?
     LEFT JOIN article_scores ascore ON ascore.article_id = a.id AND ascore.user_id = ?
     LEFT JOIN article_summaries asum ON asum.article_id = a.id
     LEFT JOIN (
       SELECT src2.article_id, f.title AS feed_title, src2.feed_id
       FROM article_sources src2
       JOIN feeds f ON f.id = src2.feed_id
     ) src ON src.article_id = a.id
     WHERE ca.collection_id = ?
     ORDER BY ca.position, ca.added_at DESC`,
    [userId, userId, collectionId],
  );

  return c.json({
    ok: true,
    data: {
      collection: { ...collection, article_count: articles.length },
      articles,
    },
  });
});

// PATCH /collections/:id — update collection metadata
collectionRoutes.patch('/collections/:id', async (c) => {
  const userId = c.get('userId');
  const collectionId = c.req.param('id');
  const { name, description, color, icon } = await c.req.json<{
    name?: string;
    description?: string | null;
    color?: string | null;
    icon?: string | null;
  }>();

  const existing = await dbGet<Collection>(
    c.env.DB,
    `SELECT * FROM collections WHERE id = ? AND user_id = ?`,
    [collectionId, userId],
  );

  if (!existing) {
    return c.json({ ok: false, error: { code: 'not_found', message: 'Collection not found' } }, 404);
  }

  const now = Date.now();
  await dbRun(
    c.env.DB,
    `UPDATE collections SET
       name = ?,
       description = ?,
       color = ?,
       icon = ?,
       updated_at = ?
     WHERE id = ? AND user_id = ?`,
    [
      name?.trim() ?? existing.name,
      description !== undefined ? (description ?? null) : existing.description,
      color !== undefined ? (color ?? null) : existing.color,
      icon !== undefined ? (icon ?? null) : existing.icon,
      now,
      collectionId, userId,
    ],
  );

  const updated = await dbGet<Collection>(c.env.DB, `SELECT * FROM collections WHERE id = ?`, [collectionId]);
  return c.json({ ok: true, data: updated });
});

// DELETE /collections/:id — delete collection (cascade removes junction rows)
collectionRoutes.delete('/collections/:id', async (c) => {
  const userId = c.get('userId');
  const collectionId = c.req.param('id');

  const result = await dbRun(
    c.env.DB,
    `DELETE FROM collections WHERE id = ? AND user_id = ?`,
    [collectionId, userId],
  );

  if (!result.meta.changes) {
    return c.json({ ok: false, error: { code: 'not_found', message: 'Collection not found' } }, 404);
  }

  return c.json({ ok: true, data: null });
});

// POST /collections/:id/articles — add article to collection
collectionRoutes.post('/collections/:id/articles', async (c) => {
  const userId = c.get('userId');
  const collectionId = c.req.param('id');
  const { articleId } = await c.req.json<{ articleId: string }>();

  // Verify ownership
  const collection = await dbGet<Collection>(
    c.env.DB,
    `SELECT id FROM collections WHERE id = ? AND user_id = ?`,
    [collectionId, userId],
  );

  if (!collection) {
    return c.json({ ok: false, error: { code: 'not_found', message: 'Collection not found' } }, 404);
  }

  // Get next position
  const last = await dbGet<{ max_pos: number | null }>(
    c.env.DB,
    `SELECT MAX(position) AS max_pos FROM collection_articles WHERE collection_id = ?`,
    [collectionId],
  );
  const position = (last?.max_pos ?? -1) + 1;

  const id = nanoid();
  const now = Date.now();
  await dbRun(
    c.env.DB,
    `INSERT INTO collection_articles (id, collection_id, article_id, position, added_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (collection_id, article_id) DO NOTHING`,
    [id, collectionId, articleId, position, now],
  );

  return c.json({ ok: true, data: { collectionId, articleId, position } }, 201);
});

// DELETE /collections/:id/articles/:articleId — remove article from collection
collectionRoutes.delete('/collections/:id/articles/:articleId', async (c) => {
  const userId = c.get('userId');
  const collectionId = c.req.param('id');
  const articleId = c.req.param('articleId');

  // Verify ownership
  const collection = await dbGet<Collection>(
    c.env.DB,
    `SELECT id FROM collections WHERE id = ? AND user_id = ?`,
    [collectionId, userId],
  );

  if (!collection) {
    return c.json({ ok: false, error: { code: 'not_found', message: 'Collection not found' } }, 404);
  }

  await dbRun(
    c.env.DB,
    `DELETE FROM collection_articles WHERE collection_id = ? AND article_id = ?`,
    [collectionId, articleId],
  );

  return c.json({ ok: true, data: null });
});

// GET /articles/:articleId/collections — get collections an article belongs to
collectionRoutes.get('/articles/:articleId/collections', async (c) => {
  const userId = c.get('userId');
  const articleId = c.req.param('articleId');

  const rows = await dbAll<Collection>(
    c.env.DB,
    `SELECT c.*
     FROM collections c
     JOIN collection_articles ca ON ca.collection_id = c.id
     WHERE c.user_id = ? AND ca.article_id = ?
     ORDER BY c.position`,
    [userId, articleId],
  );

  return c.json({ ok: true, data: rows });
});
