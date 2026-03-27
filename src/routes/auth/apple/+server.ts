import { redirect } from '@sveltejs/kit';
import { buildOAuthAuthorizeUrl, isSupabaseConfigured } from '$lib/server/supabase-auth';
import { createOpaqueToken, sha256Base64Url } from '$lib/server/oauth/crypto';

export const GET = async ({ url, platform, cookies }) => {
  if (!isSupabaseConfigured(platform.env)) {
    throw redirect(303, '/login?error=apple_not_configured');
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
};
