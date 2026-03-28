import { json } from '@sveltejs/kit';
import { exchangeAuthorizationCodeGrant, exchangeRefreshTokenGrant } from '$lib/server/oauth/tokens';
import { assertPublicOauthRequest, withAudienceOauthCors } from '$lib/server/oauth/http';
import { recordAuditEvent } from '$lib/server/audit';

const oauthError = (errorCode: string, description: string) => ({
  error: errorCode,
  error_description: description
});

const objectToForm = (payload: Record<string, unknown>) => {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(payload)) {
    if (value === null || value === undefined) continue;
    form.set(key, String(value));
  }
  return form;
};

const parseTokenRequest = async (request: Request) => {
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
  const body = await request.text();
  if (!body.trim()) {
    throw new Error('Token request body is invalid.');
  }

  if (contentType.includes('application/json') || body.trim().startsWith('{')) {
    const payload = JSON.parse(body);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('Token request body is invalid.');
    }
    return objectToForm(payload as Record<string, unknown>);
  }

  return new URLSearchParams(body);
};

export const OPTIONS = async ({ request, platform }) =>
  withAudienceOauthCors(new Response(null, { status: 204 }), request, platform.env, null);

export const POST = async ({ request, platform, locals }) => {
  const audience = assertPublicOauthRequest(new URL(request.url), platform.env);

  let form: URLSearchParams;
  try {
    form = await parseTokenRequest(request);
  } catch {
    return withAudienceOauthCors(
      json(oauthError('invalid_request', 'Token request body is invalid.'), { status: 400 }),
      request,
      platform.env,
      audience
    );
  }

  const grantType = form.get('grant_type')?.trim() ?? '';
  try {
    const payload =
      grantType === 'authorization_code'
        ? await exchangeAuthorizationCodeGrant(locals.db, platform.env, audience, form)
        : grantType === 'refresh_token'
          ? await exchangeRefreshTokenGrant(locals.db, platform.env, audience, form)
          : null;
    if (!payload) {
      return withAudienceOauthCors(
        json(oauthError('unsupported_grant_type', 'Only authorization_code and refresh_token are supported.'), {
          status: 400
        }),
        request,
        platform.env,
        audience
      );
    }

    await recordAuditEvent(locals.db, {
      actor: locals.user ? 'admin' : 'system',
      action: `oauth.token.${grantType || 'unknown'}.issued`,
      target: form.get('client_id')?.trim() || null,
      requestId: locals.requestId
    });

    return withAudienceOauthCors(json(payload), request, platform.env, audience);
  } catch (err) {
    const status = err && typeof err === 'object' && 'status' in err ? Number((err as { status?: number }).status ?? 400) : 400;
    const message = err && typeof err === 'object' && 'body' in err
      ? String((err as { body?: { message?: string } }).body?.message ?? 'Token request failed.')
      : err instanceof Error
        ? err.message
        : 'Token request failed.';
    await recordAuditEvent(locals.db, {
      actor: locals.user ? 'admin' : 'system',
      action: 'oauth.token.failed',
      target: form.get('client_id')?.trim() || null,
      requestId: locals.requestId,
      metadata: {
        grant_type: grantType || null,
        status,
        message
      }
    });
    return withAudienceOauthCors(
      json(oauthError(status === 400 ? 'invalid_grant' : 'server_error', message), { status }),
      request,
      platform.env,
      audience
    );
  }
};
