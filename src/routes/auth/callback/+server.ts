import { redirect } from '@sveltejs/kit';
import { exchangeOAuthCode, verifyOtpTokenHash } from '$lib/server/supabase-auth';
import { createSessionValue, getOrCreateLocalUser, SESSION_COOKIE } from '$lib/server/auth';
import { createCsrfToken, CSRF_COOKIE } from '$lib/server/security';
import { recordAuditEvent } from '$lib/server/audit';
import { logInfo, logWarn } from '$lib/server/log';
import { ensureSchema } from '$lib/server/migrations';

export const GET = async ({ url, platform, cookies }) => {
  // OAuth error (user cancelled or Apple returned an error)
  const oauthError = url.searchParams.get('error');
  if (oauthError) {
    const desc = url.searchParams.get('error_description') ?? oauthError;
    logWarn('auth.oauth.callback.error', { error: oauthError, desc });
    throw redirect(303, `/login?error=${encodeURIComponent(desc)}`);
  }

  await ensureSchema(platform.env.DB);

  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash') ?? '';
  const type = url.searchParams.get('type') ?? 'email';

  let authUser: { id: string; email: string } | undefined;
  let authProvider: string;

  if (code) {
    // OAuth PKCE flow (Apple Sign In)
    const codeVerifier = cookies.get('nn_pkce_verifier');
    cookies.delete('nn_pkce_verifier', { path: '/auth/callback' });

    if (!codeVerifier) {
      throw redirect(303, '/login?error=missing_verifier');
    }

    const result = await exchangeOAuthCode(platform.env, code, codeVerifier);
    if (!result.ok || !result.user) {
      logWarn('auth.oauth.callback.failed', { error: result.error });
      throw redirect(303, `/login?error=${encodeURIComponent(result.error ?? 'oauth_failed')}`);
    }

    authUser = result.user;
    authProvider = 'apple';
  } else if (tokenHash) {
    // Magic link OTP flow
    const result = await verifyOtpTokenHash(platform.env, tokenHash, type);
    if (!result.ok || !result.user) {
      logWarn('auth.supabase.callback.failed', { error: result.error });
      throw redirect(303, `/login?error=${encodeURIComponent(result.error ?? 'verification_failed')}`);
    }

    authUser = result.user;
    authProvider = 'supabase';
  } else {
    throw redirect(303, '/login?error=missing_token');
  }

  // Create or find the local user
  const user = await getOrCreateLocalUser(platform.env.DB, {
    externalId: authUser.id,
    email: authUser.email,
    authProvider
  });

  // Create session
  const secure = url.protocol === 'https:';
  const sessionValue = await createSessionValue(platform.env.SESSION_SECRET, user.id);
  cookies.set(SESSION_COOKIE, sessionValue, {
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

  await recordAuditEvent(platform.env.DB, {
    actor: user.role === 'admin' ? 'admin' : 'system',
    action: `auth.${authProvider}.login.success`,
    target: authUser.email
  });

  logInfo(`auth.${authProvider}.login.success`, { user_id: user.id, email: authUser.email });

  // Determine redirect destination
  const nextCookie = cookies.get('nn_oauth_next') ?? '';
  cookies.delete('nn_oauth_next', { path: '/auth/callback' });
  const redirectTo = nextCookie || url.searchParams.get('redirect_to') || '/';

  let destination = '/';
  try {
    const parsed = new URL(redirectTo, url);
    if (parsed.origin === url.origin) {
      destination = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
  } catch {
    // ignore
  }

  throw redirect(303, destination);
};
