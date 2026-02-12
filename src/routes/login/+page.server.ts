import { fail, redirect } from '@sveltejs/kit';
import { createSessionValue, SESSION_COOKIE, verifyPassword } from '$lib/server/auth';

export const actions = {
  default: async ({ request, platform, cookies }) => {
    const data = await request.formData();
    const password = String(data.get('password') ?? '');
    if (!password) return fail(400, { error: 'Password required' });

    const valid = await verifyPassword(password, platform.env.ADMIN_PASSWORD_HASH);
    if (!valid) return fail(401, { error: 'Invalid password' });

    const secure = new URL(request.url).protocol === 'https:';
    const value = await createSessionValue(platform.env.SESSION_SECRET);
    cookies.set(SESSION_COOKIE, value, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 14
    });

    throw redirect(303, '/');
  }
};
