import { json } from '@sveltejs/kit';
import { nanoid } from 'nanoid';
import { dbRun, dbGet, now } from '$lib/server/db';
import { requireMobileAccess } from '$lib/server/mobile/auth';

export const POST = async ({ request, platform }) => {
  await requireMobileAccess(request, platform.env, platform.env.DB, 'app:write');

  const body = await request.json().catch(() => ({}));
  const token = typeof body?.token === 'string' ? body.token.trim() : '';
  const devicePlatform = typeof body?.platform === 'string' ? body.platform : 'ios';

  if (!token) {
    return json({ error: 'Missing token' }, { status: 400 });
  }

  const timestamp = now();
  const existing = await dbGet(platform.env.DB,
    'SELECT id FROM device_tokens WHERE token = ?', [token]);

  if (existing) {
    await dbRun(platform.env.DB,
      'UPDATE device_tokens SET updated_at = ? WHERE token = ?',
      [timestamp, token]);
  } else {
    await dbRun(platform.env.DB,
      'INSERT INTO device_tokens (id, token, platform, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [nanoid(), token, devicePlatform, timestamp, timestamp]);
  }

  return json({ ok: true });
};

export const DELETE = async ({ request, platform }) => {
  await requireMobileAccess(request, platform.env, platform.env.DB, 'app:write');

  const body = await request.json().catch(() => ({}));
  const token = typeof body?.token === 'string' ? body.token.trim() : '';

  if (!token) {
    return json({ error: 'Missing token' }, { status: 400 });
  }

  await dbRun(platform.env.DB,
    'DELETE FROM device_tokens WHERE token = ?', [token]);

  return json({ ok: true });
};
