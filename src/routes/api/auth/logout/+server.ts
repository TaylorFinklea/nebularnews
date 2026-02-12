import { json } from '@sveltejs/kit';
import { clearSessionCookie } from '$lib/server/auth';

export const POST = async ({ request }) => {
  const secure = new URL(request.url).protocol === 'https:';
  const cookie = clearSessionCookie(secure);
  return json({ ok: true }, { headers: { 'set-cookie': cookie } });
};
