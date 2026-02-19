import { fail, isRedirect, redirect } from '@sveltejs/kit';
import { createSessionValue, SESSION_COOKIE, verifyPassword } from '$lib/server/auth';
import { createCsrfToken, CSRF_COOKIE } from '$lib/server/security';
import { clearLoginAttempts, getAuthIdentifier, getThrottleRemainingMs, registerFailedLogin } from '$lib/server/login-throttle';
import { recordAuditEvent } from '$lib/server/audit';
import { logError, logInfo, logWarn, summarizeError } from '$lib/server/log';

export const actions = {
  default: async ({ request, platform, cookies, locals, url }) => {
    const requestId = locals.requestId ?? null;
    const stage = platform.env.APP_ENV ?? 'development';
    const route = '/login';
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
        return fail(429, { error: `Too many attempts. Try again in ${Math.ceil(delayMs / 1000)}s.` });
      }

      const data = await request.formData();
      const password = String(data.get('password') ?? '');
      if (!password) return fail(400, { error: 'Password required' });

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
          return fail(429, { error: `Too many attempts. Try again in ${Math.ceil(throttled.remainingMs / 1000)}s.` });
        }
        logWarn('auth.login.invalid_password', {
          request_id: requestId,
          route,
          stage
        });
        return fail(401, { error: 'Invalid password' });
      }

      await clearLoginAttempts(platform.env.DB, identifier);
      await recordAuditEvent(platform.env.DB, {
        actor: 'admin',
        action: 'auth.login.success',
        target: identifier
      });

      const secure = url.protocol === 'https:';
      const value = await createSessionValue(platform.env.SESSION_SECRET);
      cookies.set(SESSION_COOKIE, value, {
        httpOnly: true,
        secure,
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 14
      });
      cookies.set(CSRF_COOKIE, createCsrfToken(), {
        httpOnly: false,
        secure,
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 14
      });

      logInfo('auth.login.success', {
        request_id: requestId,
        route,
        stage
      });
      throw redirect(303, '/');
    } catch (error) {
      if (isRedirect(error)) throw error;
      logError('auth.login.exception', {
        request_id: requestId,
        route,
        stage,
        error: summarizeError(error)
      });
      return fail(503, { error: 'Authentication service unavailable' });
    }
  }
};
