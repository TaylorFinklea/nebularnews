/**
 * Supabase Auth REST API client for CF Workers.
 * No SDK dependency — just HTTP calls to the GoTrue API.
 */

export function isSupabaseConfigured(env: App.Platform['env']): boolean {
  return Boolean(env.SUPABASE_URL?.trim() && env.SUPABASE_ANON_KEY?.trim());
}

/**
 * Send a magic link (OTP) email to the given address.
 * Calls POST /auth/v1/otp on the Supabase GoTrue API.
 */
export async function sendMagicLink(
  env: App.Platform['env'],
  email: string,
  redirectTo?: string
): Promise<{ ok: boolean; error?: string }> {
  const url = `${env.SUPABASE_URL}/auth/v1/otp`;
  const body: Record<string, unknown> = {
    email,
    create_user: true
  };
  if (redirectTo) {
    body.options = { email_redirect_to: redirectTo };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: env.SUPABASE_ANON_KEY!
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: false, error: String(data?.msg ?? data?.error_description ?? 'Failed to send magic link') };
  }

  return { ok: true };
}

/**
 * Verify an OTP token hash from a magic link callback.
 * Calls POST /auth/v1/verify on the Supabase GoTrue API.
 * Returns the Supabase access token (JWT) and user info on success.
 */
export async function verifyOtpTokenHash(
  env: App.Platform['env'],
  tokenHash: string,
  type = 'email'
): Promise<{
  ok: boolean;
  accessToken?: string;
  user?: { id: string; email: string };
  error?: string;
}> {
  const url = `${env.SUPABASE_URL}/auth/v1/verify`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: env.SUPABASE_ANON_KEY!
    },
    body: JSON.stringify({ token_hash: tokenHash, type })
  });

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: false, error: String(data?.msg ?? data?.error_description ?? 'Verification failed') };
  }

  const data = (await res.json()) as {
    access_token?: string;
    user?: { id?: string; email?: string };
  };

  if (!data.access_token || !data.user?.id || !data.user?.email) {
    return { ok: false, error: 'Invalid verification response' };
  }

  return {
    ok: true,
    accessToken: data.access_token,
    user: { id: data.user.id, email: data.user.email }
  };
}
