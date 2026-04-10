import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import type { AppEnv } from '../index';
import { dbAll, dbGet, dbRun } from '../db/helpers';

export const tagRoutes = new Hono<AppEnv>();

interface Tag {
  id: string;
  name: string;
  name_normalized: string;
  slug: string;
}

interface TagWithCount extends Tag {
  article_count: number;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function findOrCreateTag(db: D1Database, name: string): Promise<Tag> {
  const normalized = name.toLowerCase().trim();
  const existing = await dbGet<Tag>(
    db,
    `SELECT * FROM tags WHERE name_normalized = ?`,
    [normalized],
  );
  if (existing) return existing;

  const tag: Tag = {
    id: nanoid(),
    name: name.trim(),
    name_normalized: normalized,
    slug: slugify(name),
  };
  await dbRun(
    db,
    `INSERT INTO tags (id, name, name_normalized, slug) VALUES (?, ?, ?, ?)`,
    [tag.id, tag.name, tag.name_normalized, tag.slug],
  );
  return tag;
}

async function getArticleTags(db: D1Database, userId: string, articleId: string) {
  return dbAll<Tag>(
    db,
    `SELECT t.id, t.name, t.name_normalized, t.slug
     FROM article_tags at_
     JOIN tags t ON t.id = at_.tag_id
     WHERE at_.user_id = ? AND at_.article_id = ?`,
    [userId, articleId],
  );
}

// GET /tags — list tags with article count
tagRoutes.get('/tags', async (c) => {
  const userId = c.get('userId');
  const query = c.req.query('query');
  const limit = parseInt(c.req.query('limit') ?? '100', 10);

  let sql = `SELECT t.id, t.name, t.name_normalized, t.slug,
                    COUNT(at_.id) AS article_count
             FROM tags t
             LEFT JOIN article_tags at_ ON at_.tag_id = t.id AND at_.user_id = ?`;
  const params: unknown[] = [userId];

  if (query) {
    sql += ` WHERE t.name_normalized LIKE ?`;
    params.push(`%${query.toLowerCase()}%`);
  }

  sql += ` GROUP BY t.id ORDER BY article_count DESC LIMIT ?`;
  params.push(limit);

  const rows = await dbAll<TagWithCount>(c.env.DB, sql, params);
  return c.json({ ok: true, data: rows });
});

// POST /tags — create a new tag
tagRoutes.post('/tags', async (c) => {
  const { name } = await c.req.json<{ name: string }>();
  const tag = await findOrCreateTag(c.env.DB, name);
  return c.json({ ok: true, data: tag });
});

// DELETE /tags/:id — delete tag and cascade article_tags
tagRoutes.delete('/tags/:id', async (c) => {
  const tagId = c.req.param('id');
  await dbRun(c.env.DB, `DELETE FROM article_tags WHERE tag_id = ?`, [tagId]);
  await dbRun(c.env.DB, `DELETE FROM tags WHERE id = ?`, [tagId]);
  return c.json({ ok: true, data: null });
});

// POST /articles/:articleId/tags — add a tag to an article
tagRoutes.post('/articles/:articleId/tags', async (c) => {
  const userId = c.get('userId');
  const articleId = c.req.param('articleId');
  const { name } = await c.req.json<{ name: string }>();

  const tag = await findOrCreateTag(c.env.DB, name);

  const id = nanoid();
  const now = Date.now();
  await dbRun(
    c.env.DB,
    `INSERT INTO article_tags (id, user_id, article_id, tag_id, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'manual', ?, ?)
     ON CONFLICT (user_id, article_id, tag_id) DO NOTHING`,
    [id, userId, articleId, tag.id, now, now],
  );

  const tags = await getArticleTags(c.env.DB, userId, articleId);
  return c.json({ ok: true, data: tags });
});

// DELETE /articles/:articleId/tags/:tagId — remove a tag from an article
tagRoutes.delete('/articles/:articleId/tags/:tagId', async (c) => {
  const userId = c.get('userId');
  const articleId = c.req.param('articleId');
  const tagId = c.req.param('tagId');

  await dbRun(
    c.env.DB,
    `DELETE FROM article_tags WHERE user_id = ? AND article_id = ? AND tag_id = ?`,
    [userId, articleId, tagId],
  );

  const tags = await getArticleTags(c.env.DB, userId, articleId);
  return c.json({ ok: true, data: tags });
});
