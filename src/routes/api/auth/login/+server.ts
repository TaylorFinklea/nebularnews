import { json } from '@sveltejs/kit';
import { createSessionCookie, verifyPassword } from '$lib/server/auth';

export const POST = async ({ request, platform }) => {
  const { password } = await request.json();
  if (!password) return json({ error: 'Missing password' }, { status: 400 });

  const valid = await verifyPassword(password, platform.env.ADMIN_PASSWORD_HASH);
  if (!valid) return json({ error: 'Invalid password' }, { status: 401 });

  const secure = new URL(request.url).protocol === 'https:';
  const cookie = await createSessionCookie(platform.env.SESSION_SECRET, secure);
  return json({ ok: true }, { headers: { 'set-cookie': cookie } });
};
