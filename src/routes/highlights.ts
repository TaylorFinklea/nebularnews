import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import type { AppEnv } from '../index';
import { dbAll, dbGet, dbRun } from '../db/helpers';

export const highlightRoutes = new Hono<AppEnv>();

interface Highlight {
  id: string;
  user_id: string;
  article_id: string;
  selected_text: string;
  block_index: number | null;
  text_offset: number | null;
  text_length: number | null;
  note: string | null;
  color: string;
  created_at: number;
  updated_at: number;
}

// GET /articles/:articleId/highlights — get highlights for article
highlightRoutes.get('/articles/:articleId/highlights', async (c) => {
  const userId = c.get('userId');
  const articleId = c.req.param('articleId');

  const rows = await dbAll<Highlight>(
    c.env.DB,
    `SELECT * FROM article_highlights
     WHERE user_id = ? AND article_id = ?
     ORDER BY block_index, text_offset, created_at`,
    [userId, articleId],
  );

  return c.json({ ok: true, data: rows });
});

// POST /articles/:articleId/highlights — create highlight
highlightRoutes.post('/articles/:articleId/highlights', async (c) => {
  const userId = c.get('userId');
  const articleId = c.req.param('articleId');
  const { selectedText, blockIndex, textOffset, textLength, note, color } = await c.req.json<{
    selectedText: string;
    blockIndex?: number;
    textOffset?: number;
    textLength?: number;
    note?: string;
    color?: string;
  }>();

  if (!selectedText?.trim()) {
    return c.json({ ok: false, error: { code: 'invalid_input', message: 'selectedText is required' } }, 400);
  }

  const id = nanoid();
  const now = Date.now();
  await dbRun(
    c.env.DB,
    `INSERT INTO article_highlights (id, user_id, article_id, selected_text, block_index, text_offset, text_length, note, color, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, articleId, selectedText.trim(), blockIndex ?? null, textOffset ?? null, textLength ?? null, note ?? null, color ?? 'yellow', now, now],
  );

  const highlight = await dbGet<Highlight>(c.env.DB, `SELECT * FROM article_highlights WHERE id = ?`, [id]);
  return c.json({ ok: true, data: highlight }, 201);
});

// PATCH /articles/:articleId/highlights/:id — update highlight note/color
highlightRoutes.patch('/articles/:articleId/highlights/:id', async (c) => {
  const userId = c.get('userId');
  const highlightId = c.req.param('id');
  const { note, color } = await c.req.json<{ note?: string | null; color?: string }>();

  const existing = await dbGet<Highlight>(
    c.env.DB,
    `SELECT * FROM article_highlights WHERE id = ? AND user_id = ?`,
    [highlightId, userId],
  );

  if (!existing) {
    return c.json({ ok: false, error: { code: 'not_found', message: 'Highlight not found' } }, 404);
  }

  const now = Date.now();
  await dbRun(
    c.env.DB,
    `UPDATE article_highlights SET note = ?, color = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
    [note !== undefined ? (note ?? null) : existing.note, color ?? existing.color, now, highlightId, userId],
  );

  const updated = await dbGet<Highlight>(c.env.DB, `SELECT * FROM article_highlights WHERE id = ?`, [highlightId]);
  return c.json({ ok: true, data: updated });
});

// DELETE /articles/:articleId/highlights/:id — delete highlight
highlightRoutes.delete('/articles/:articleId/highlights/:id', async (c) => {
  const userId = c.get('userId');
  const highlightId = c.req.param('id');

  const result = await dbRun(
    c.env.DB,
    `DELETE FROM article_highlights WHERE id = ? AND user_id = ?`,
    [highlightId, userId],
  );

  if (!result.meta.changes) {
    return c.json({ ok: false, error: { code: 'not_found', message: 'Highlight not found' } }, 404);
  }

  return c.json({ ok: true, data: null });
});
