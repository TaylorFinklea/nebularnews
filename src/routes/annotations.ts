import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import type { AppEnv } from '../index';
import { dbGet, dbRun } from '../db/helpers';

export const annotationRoutes = new Hono<AppEnv>();

interface Annotation {
  id: string;
  user_id: string;
  article_id: string;
  content: string;
  created_at: number;
  updated_at: number;
}

// GET /articles/:articleId/annotation — get annotation for article
annotationRoutes.get('/articles/:articleId/annotation', async (c) => {
  const userId = c.get('userId');
  const articleId = c.req.param('articleId');

  const annotation = await dbGet<Annotation>(
    c.env.DB,
    `SELECT * FROM article_annotations WHERE user_id = ? AND article_id = ?`,
    [userId, articleId],
  );

  return c.json({ ok: true, data: annotation });
});

// PUT /articles/:articleId/annotation — create or update annotation
annotationRoutes.put('/articles/:articleId/annotation', async (c) => {
  const userId = c.get('userId');
  const articleId = c.req.param('articleId');
  const { content } = await c.req.json<{ content: string }>();

  if (!content?.trim()) {
    return c.json({ ok: false, error: { code: 'invalid_input', message: 'content is required' } }, 400);
  }

  const now = Date.now();
  const existing = await dbGet<Annotation>(
    c.env.DB,
    `SELECT * FROM article_annotations WHERE user_id = ? AND article_id = ?`,
    [userId, articleId],
  );

  if (existing) {
    await dbRun(
      c.env.DB,
      `UPDATE article_annotations SET content = ?, updated_at = ? WHERE id = ?`,
      [content.trim(), now, existing.id],
    );
  } else {
    const id = nanoid();
    await dbRun(
      c.env.DB,
      `INSERT INTO article_annotations (id, user_id, article_id, content, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, userId, articleId, content.trim(), now, now],
    );
  }

  const annotation = await dbGet<Annotation>(
    c.env.DB,
    `SELECT * FROM article_annotations WHERE user_id = ? AND article_id = ?`,
    [userId, articleId],
  );

  return c.json({ ok: true, data: annotation });
});

// DELETE /articles/:articleId/annotation — delete annotation
annotationRoutes.delete('/articles/:articleId/annotation', async (c) => {
  const userId = c.get('userId');
  const articleId = c.req.param('articleId');

  const result = await dbRun(
    c.env.DB,
    `DELETE FROM article_annotations WHERE user_id = ? AND article_id = ?`,
    [userId, articleId],
  );

  if (!result.meta.changes) {
    return c.json({ ok: false, error: { code: 'not_found', message: 'Annotation not found' } }, 404);
  }

  return c.json({ ok: true, data: null });
});
