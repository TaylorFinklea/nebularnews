import { redirect } from '@sveltejs/kit';
import { verifyOtpTokenHash } from '$lib/server/supabase-auth';
import { createSessionValue, getOrCreateLocalUser, SESSION_COOKIE } from '$lib/server/auth';
import { createCsrfToken, CSRF_COOKIE } from '$lib/server/security';
import { recordAuditEvent } from '$lib/server/audit';
import { logInfo, logWarn } from '$lib/server/log';
import { ensureSchema } from '$lib/server/migrations';

export const GET = async ({ url, platform, cookies }) => {
  const tokenHash = url.searchParams.get('token_hash') ?? '';
  const type = url.searchParams.get('type') ?? 'email';
  const redirectTo = url.searchParams.get('redirect_to') ?? '/';

  if (!tokenHash) {
    throw redirect(303, '/login?error=missing_token');
  }

  await ensureSchema(platform.env.DB);

  const result = await verifyOtpTokenHash(platform.env, tokenHash, type);
  if (!result.ok || !result.user) {
    logWarn('auth.supabase.callback.failed', { error: result.error });
    throw redirect(303, `/login?error=${encodeURIComponent(result.error ?? 'verification_failed')}`);
  }

  // Create or find the local user
  const user = await getOrCreateLocalUser(platform.env.DB, {
    externalId: result.user.id,
    email: result.user.email,
    authProvider: 'supabase'
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
    action: 'auth.supabase.login.success',
    target: result.user.email
  });

  logInfo('auth.supabase.login.success', { user_id: user.id, email: result.user.email });

  // Redirect to the app
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
