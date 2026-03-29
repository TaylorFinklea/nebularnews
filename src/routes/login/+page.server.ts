import { fail, isRedirect, redirect } from '@sveltejs/kit';
import { createSessionValue, SESSION_COOKIE, verifyPassword } from '$lib/server/auth';
import { createCsrfToken, CSRF_COOKIE } from '$lib/server/security';
import { clearLoginAttempts, getAuthIdentifier, getThrottleRemainingMs, registerFailedLogin } from '$lib/server/login-throttle';
import { recordAuditEvent } from '$lib/server/audit';
import { logError, logInfo, logWarn, summarizeError } from '$lib/server/log';
import { isSupabaseConfigured, sendMagicLink } from '$lib/server/supabase-auth';

export const load = async ({ locals, url }) => {
  return {
    hasPassword: Boolean(locals.env.ADMIN_PASSWORD_HASH?.trim()),
    hasSupabase: isSupabaseConfigured(locals.env),
    error: url.searchParams.get('error') ?? null
  };
};

export const actions = {
  magiclink: async ({ request, locals, url }) => {
    const data = await request.formData();
    const email = String(data.get('email') ?? '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      return fail(400, { magicLinkError: 'Valid email required', magicLinkSent: false });
    }

    if (!isSupabaseConfigured(locals.env)) {
      return fail(503, { magicLinkError: 'Email login is not configured', magicLinkSent: false });
    }

    const callbackUrl = `${url.origin}/auth/callback`;
    const result = await sendMagicLink(locals.env, email, callbackUrl);
    if (!result.ok) {
      return fail(500, { magicLinkError: result.error ?? 'Failed to send', magicLinkSent: false });
    }

    return { magicLinkSent: true, magicLinkEmail: email };
  },

  password: async ({ request, cookies, locals, url }) => {
    const requestId = locals.requestId ?? null;
    const stage = locals.env.APP_ENV ?? 'development';
    const route = '/login';
    const identifier = getAuthIdentifier(request);

    logInfo('auth.login.attempt', {
      request_id: requestId,
      route,
      stage
    });

    try {
      const delayMs = await getThrottleRemainingMs(locals.db, identifier);
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

      const valid = await verifyPassword(password, locals.env.ADMIN_PASSWORD_HASH);
      if (!valid) {
        const throttled = await registerFailedLogin(locals.db, identifier);
        await recordAuditEvent(locals.db, {
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

      await clearLoginAttempts(locals.db, identifier);
      await recordAuditEvent(locals.db, {
        actor: 'admin',
        action: 'auth.login.success',
        target: identifier
      });

      const secure = url.protocol === 'https:';
      const value = await createSessionValue(locals.env.SESSION_SECRET);
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
      const nextRaw = String(data.get('next') ?? url.searchParams.get('next') ?? '').trim();
      let nextDestination = '/';
      if (nextRaw) {
        try {
          const parsed = new URL(nextRaw, url);
          if (parsed.origin === url.origin) {
            nextDestination = `${parsed.pathname}${parsed.search}${parsed.hash}`;
          }
        } catch {
          nextDestination = '/';
        }
      }
      throw redirect(303, nextDestination);
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
