import { fail, isRedirect, redirect } from '@sveltejs/kit';
import { createSessionValue, SESSION_COOKIE, verifyPassword } from '$lib/server/auth';
import { createCsrfToken, CSRF_COOKIE } from '$lib/server/security';
import { clearLoginAttempts, getAuthIdentifier, getThrottleRemainingMs, registerFailedLogin } from '$lib/server/login-throttle';
import { recordAuditEvent } from '$lib/server/audit';
import { logError, logInfo, logWarn, summarizeError } from '$lib/server/log';
import { buildOAuthAuthorizeUrl, isSupabaseConfigured, sendMagicLink } from '$lib/server/supabase-auth';
import { createOpaqueToken, sha256Base64Url } from '$lib/server/oauth/crypto';

export const load = async ({ platform, url }) => {
  return {
    hasPassword: Boolean(platform.env.ADMIN_PASSWORD_HASH?.trim()),
    hasSupabase: isSupabaseConfigured(platform.env),
    error: url.searchParams.get('error') ?? null
  };
};

export const actions = {
  apple: async ({ platform, url, cookies }) => {
    if (!isSupabaseConfigured(platform.env)) {
      return fail(503, { error: 'Apple Sign In is not configured' });
    }

    const codeVerifier = createOpaqueToken(32);
    const codeChallenge = await sha256Base64Url(codeVerifier);
    const secure = url.protocol === 'https:';

    cookies.set('nn_pkce_verifier', codeVerifier, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/auth/callback',
      maxAge: 60 * 10
    });

    const next = url.searchParams.get('next') ?? '';
    if (next) {
      cookies.set('nn_oauth_next', next, {
        httpOnly: true,
        secure,
        sameSite: 'lax',
        path: '/auth/callback',
        maxAge: 60 * 10
      });
    }

    const callbackUrl = `${url.origin}/auth/callback`;
    throw redirect(303, buildOAuthAuthorizeUrl(platform.env, 'apple', callbackUrl, codeChallenge));
  },

  magiclink: async ({ request, platform, url }) => {
    const data = await request.formData();
    const email = String(data.get('email') ?? '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      return fail(400, { magicLinkError: 'Valid email required', magicLinkSent: false });
    }

    if (!isSupabaseConfigured(platform.env)) {
      return fail(503, { magicLinkError: 'Email login is not configured', magicLinkSent: false });
    }

    const callbackUrl = `${url.origin}/auth/callback`;
    const result = await sendMagicLink(platform.env, email, callbackUrl);
    if (!result.ok) {
      return fail(500, { magicLinkError: result.error ?? 'Failed to send', magicLinkSent: false });
    }

    return { magicLinkSent: true, magicLinkEmail: email };
  },

  password: async ({ request, platform, cookies, locals, url }) => {
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
