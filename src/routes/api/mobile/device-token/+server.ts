import { json } from '@sveltejs/kit';
import { nanoid } from 'nanoid';
import { dbRun, dbGet, now } from '$lib/server/db';
import { requireMobileAccess } from '$lib/server/mobile/auth';

export const POST = async ({ request, locals }) => {
  const { user } = await requireMobileAccess(request, locals.env, locals.db, 'app:write');

  const body = await request.json().catch(() => ({}));
  const token = typeof body?.token === 'string' ? body.token.trim() : '';
  const devicePlatform = typeof body?.platform === 'string' ? body.platform : 'ios';

  if (!token) {
    return json({ error: 'Missing token' }, { status: 400 });
  }

  const timestamp = now();
  const existing = await dbGet(locals.db,
    'SELECT id FROM device_tokens WHERE token = ? AND user_id = ?', [token, user.id]);

  if (existing) {
    await dbRun(locals.db,
      'UPDATE device_tokens SET updated_at = ? WHERE token = ? AND user_id = ?',
      [timestamp, token, user.id]);
  } else {
    await dbRun(locals.db,
      'INSERT INTO device_tokens (id, user_id, token, platform, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [nanoid(), user.id, token, devicePlatform, timestamp, timestamp]);
  }

  return json({ ok: true });
};

export const DELETE = async ({ request, locals }) => {
  const { user } = await requireMobileAccess(request, locals.env, locals.db, 'app:write');

  const body = await request.json().catch(() => ({}));
  const token = typeof body?.token === 'string' ? body.token.trim() : '';

  if (!token) {
    return json({ error: 'Missing token' }, { status: 400 });
  }

  await dbRun(locals.db,
    'DELETE FROM device_tokens WHERE token = ? AND user_id = ?', [token, user.id]);

  return json({ ok: true });
};
