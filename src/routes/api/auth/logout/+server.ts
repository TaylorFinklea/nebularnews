import { json } from '@sveltejs/kit';
import { clearSessionCookie } from '$lib/server/auth';
import { clearCsrfCookie } from '$lib/server/security';
import { recordAuditEvent } from '$lib/server/audit';

export const POST = async ({ request, platform, locals }) => {
  const secure = new URL(request.url).protocol === 'https:';
  const cookie = clearSessionCookie(secure);
  const csrf = clearCsrfCookie(secure);
  await recordAuditEvent(platform.env.DB, {
    actor: locals.user ? 'admin' : 'system',
    action: 'auth.logout',
    requestId: locals.requestId
  });

  const headers = new Headers();
  headers.append('set-cookie', cookie);
  headers.append('set-cookie', csrf);
  return json({ ok: true }, { headers });
};
