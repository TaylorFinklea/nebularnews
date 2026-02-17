import { json } from '@sveltejs/kit';
import { createSessionCookie, verifyPassword } from '$lib/server/auth';
import { createCsrfToken, buildCsrfCookie } from '$lib/server/security';
import { clearLoginAttempts, getAuthIdentifier, getThrottleRemainingMs, registerFailedLogin } from '$lib/server/login-throttle';
import { recordAuditEvent } from '$lib/server/audit';

export const POST = async ({ request, platform }) => {
  const identifier = getAuthIdentifier(request);
  const delayMs = await getThrottleRemainingMs(platform.env.DB, identifier);
  if (delayMs > 0) {
    return json({ error: `Too many attempts. Try again in ${Math.ceil(delayMs / 1000)}s.` }, { status: 429 });
  }

  const { password } = await request.json();
  if (!password) return json({ error: 'Missing password' }, { status: 400 });

  const valid = await verifyPassword(password, platform.env.ADMIN_PASSWORD_HASH);
  if (!valid) {
    const throttled = await registerFailedLogin(platform.env.DB, identifier);
    await recordAuditEvent(platform.env.DB, {
      actor: 'system',
      action: 'auth.login.failed',
      target: identifier,
      metadata: { failed_count: throttled.failedCount, blocked_until: throttled.blockedUntil }
    });
    if (throttled.remainingMs > 0) {
      return json({ error: `Too many attempts. Try again in ${Math.ceil(throttled.remainingMs / 1000)}s.` }, { status: 429 });
    }
    return json({ error: 'Invalid password' }, { status: 401 });
  }

  await clearLoginAttempts(platform.env.DB, identifier);
  await recordAuditEvent(platform.env.DB, {
    actor: 'admin',
    action: 'auth.login.success',
    target: identifier
  });

  const secure = new URL(request.url).protocol === 'https:';
  const cookie = await createSessionCookie(platform.env.SESSION_SECRET, secure);
  const csrfCookie = buildCsrfCookie(createCsrfToken(), secure);
  const headers = new Headers();
  headers.append('set-cookie', cookie);
  headers.append('set-cookie', csrfCookie);
  return json({ ok: true }, { headers });
};
