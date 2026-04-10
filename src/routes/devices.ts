import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import type { AppEnv } from '../index';
import { dbGet, dbRun } from '../db/helpers';

export const deviceRoutes = new Hono<AppEnv>();

interface DeviceToken {
  id: string;
  user_id: string;
  token: string;
}

deviceRoutes.post('/devices/register', async (c) => {
  const db = c.env.DB;
  const userId = c.get('userId');
  const { token } = await c.req.json<{ token: string }>();

  if (!token) {
    return c.json({ ok: false, error: 'token is required' }, 400);
  }

  const existing = await dbGet<DeviceToken>(
    db,
    'SELECT id, user_id, token FROM device_tokens WHERE token = ?',
    [token],
  );

  const now = Date.now();

  if (existing) {
    await dbRun(
      db,
      'UPDATE device_tokens SET user_id = ?, updated_at = ? WHERE id = ?',
      [userId, now, existing.id],
    );
  } else {
    await dbRun(
      db,
      'INSERT INTO device_tokens (id, user_id, token, platform, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [nanoid(), userId, token, 'ios', now, now],
    );
  }

  return c.json({ ok: true, data: { registered: true } });
});

deviceRoutes.post('/devices/remove', async (c) => {
  const db = c.env.DB;
  const userId = c.get('userId');
  const { token } = await c.req.json<{ token: string }>();

  if (!token) {
    return c.json({ ok: false, error: 'token is required' }, 400);
  }

  await dbRun(
    db,
    'DELETE FROM device_tokens WHERE user_id = ? AND token = ?',
    [userId, token],
  );

  return c.json({ ok: true, data: { removed: true } });
});
