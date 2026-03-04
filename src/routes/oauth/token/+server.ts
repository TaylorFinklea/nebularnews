import { json } from '@sveltejs/kit';
import { exchangeAuthorizationCodeGrant, exchangeRefreshTokenGrant } from '$lib/server/oauth/tokens';
import { assertPublicMcpRequest, withPublicOauthCors } from '$lib/server/oauth/http';
import { recordAuditEvent } from '$lib/server/audit';

const oauthError = (errorCode: string, description: string) => ({
  error: errorCode,
  error_description: description
});

export const OPTIONS = async ({ request, platform }) =>
  withPublicOauthCors(new Response(null, { status: 204 }), request, platform.env);

export const POST = async ({ request, platform, locals }) => {
  assertPublicMcpRequest(new URL(request.url), platform.env);

  let form: URLSearchParams;
  try {
    form = new URLSearchParams(await request.text());
  } catch {
    return withPublicOauthCors(
      json(oauthError('invalid_request', 'Token request body is invalid.'), { status: 400 }),
      request,
      platform.env
    );
  }

  const grantType = form.get('grant_type')?.trim() ?? '';
  try {
    const payload =
      grantType === 'authorization_code'
        ? await exchangeAuthorizationCodeGrant(platform.env.DB, platform.env, form)
        : grantType === 'refresh_token'
          ? await exchangeRefreshTokenGrant(platform.env.DB, platform.env, form)
          : null;
    if (!payload) {
      return withPublicOauthCors(
        json(oauthError('unsupported_grant_type', 'Only authorization_code and refresh_token are supported.'), {
          status: 400
        }),
        request,
        platform.env
      );
    }

    await recordAuditEvent(platform.env.DB, {
      actor: locals.user ? 'admin' : 'system',
      action: `oauth.token.${grantType || 'unknown'}.issued`,
      target: form.get('client_id')?.trim() || null,
      requestId: locals.requestId
    });

    return withPublicOauthCors(json(payload), request, platform.env);
  } catch (err) {
    const status = err && typeof err === 'object' && 'status' in err ? Number((err as { status?: number }).status ?? 400) : 400;
    const message = err && typeof err === 'object' && 'body' in err
      ? String((err as { body?: { message?: string } }).body?.message ?? 'Token request failed.')
      : err instanceof Error
        ? err.message
        : 'Token request failed.';
    return withPublicOauthCors(
      json(oauthError(status === 400 ? 'invalid_grant' : 'server_error', message), { status }),
      request,
      platform.env
    );
  }
};
