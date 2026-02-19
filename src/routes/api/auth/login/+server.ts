import { json } from '@sveltejs/kit';
import { createSessionCookie, verifyPassword } from '$lib/server/auth';
import { createCsrfToken, buildCsrfCookie } from '$lib/server/security';
import { clearLoginAttempts, getAuthIdentifier, getThrottleRemainingMs, registerFailedLogin } from '$lib/server/login-throttle';
import { recordAuditEvent } from '$lib/server/audit';
import { logError, logInfo, logWarn, summarizeError } from '$lib/server/log';

export const POST = async ({ request, platform, locals, url }) => {
  const requestId = locals.requestId ?? null;
  const stage = platform.env.APP_ENV ?? 'development';
  const route = '/api/auth/login';
  const identifier = getAuthIdentifier(request);

  logInfo('auth.login.attempt', {
    request_id: requestId,
    route,
    stage
  });

  try {
    const delayMs = await getThrottleRemainingMs(platform.env.DB, identifier);
    if (delayMs > 0) {
      logWarn('auth.login.throttled', {
        request_id: requestId,
        route,
        stage,
        delay_ms: delayMs
      });
      return json({ error: `Too many attempts. Try again in ${Math.ceil(delayMs / 1000)}s.` }, { status: 429 });
    }

    let body: { password?: unknown };
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const password = typeof body.password === 'string' ? body.password : '';
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
        logWarn('auth.login.throttled', {
          request_id: requestId,
          route,
          stage,
          delay_ms: throttled.remainingMs
        });
        return json({ error: `Too many attempts. Try again in ${Math.ceil(throttled.remainingMs / 1000)}s.` }, { status: 429 });
      }
      logWarn('auth.login.invalid_password', {
        request_id: requestId,
        route,
        stage
      });
      return json({ error: 'Invalid password' }, { status: 401 });
    }

    await clearLoginAttempts(platform.env.DB, identifier);
    await recordAuditEvent(platform.env.DB, {
      actor: 'admin',
      action: 'auth.login.success',
      target: identifier
    });

    const secure = url.protocol === 'https:';
    const cookie = await createSessionCookie(platform.env.SESSION_SECRET, secure);
    const csrfCookie = buildCsrfCookie(createCsrfToken(), secure);
    const headers = new Headers();
    headers.append('set-cookie', cookie);
    headers.append('set-cookie', csrfCookie);

    logInfo('auth.login.success', {
      request_id: requestId,
      route,
      stage
    });
    return json({ ok: true }, { headers });
  } catch (error) {
    logError('auth.login.exception', {
      request_id: requestId,
      route,
      stage,
      error: summarizeError(error)
    });
    return json({ error: 'Authentication service unavailable' }, { status: 503 });
  }
};
