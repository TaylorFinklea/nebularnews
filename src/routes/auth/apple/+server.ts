import { redirect } from '@sveltejs/kit';
import { buildOAuthAuthorizeUrl, isSupabaseConfigured } from '$lib/server/supabase-auth';
import { createOpaqueToken, sha256Base64Url } from '$lib/server/oauth/crypto';

export const GET = async ({ url, locals, cookies }) => {
  if (!isSupabaseConfigured(locals.env)) {
    throw redirect(303, '/login?error=apple_not_configured');
  }

  let codeVerifier: string;
  let codeChallenge: string;
  try {
    codeVerifier = createOpaqueToken(32);
    codeChallenge = await sha256Base64Url(codeVerifier);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: 'crypto_failed', detail: msg }), {
      status: 500,
      headers: { 'content-type': 'application/json' }
    });
  }

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
  const authUrl = buildOAuthAuthorizeUrl(locals.env, 'apple', callbackUrl, codeChallenge);

  // Temporary debug: return the URL instead of redirecting
  return new Response(JSON.stringify({ debug: true, authUrl, callbackUrl }), {
    headers: { 'content-type': 'application/json' }
  });
};
