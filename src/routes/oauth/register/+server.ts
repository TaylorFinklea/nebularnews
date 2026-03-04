import { json } from '@sveltejs/kit';
import { registerDynamicClient } from '$lib/server/oauth/register';
import { assertPublicMcpRequest, withPublicOauthCors } from '$lib/server/oauth/http';
import { recordAuditEvent } from '$lib/server/audit';

const asOAuthError = (message: string) => ({
  error: 'invalid_client_metadata',
  error_description: message
});

export const OPTIONS = async ({ request, platform }) =>
  withPublicOauthCors(new Response(null, { status: 204 }), request, platform.env);

export const POST = async ({ request, platform, locals }) => {
  assertPublicMcpRequest(new URL(request.url), platform.env);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return withPublicOauthCors(
      json(asOAuthError('Request body must be valid JSON.'), { status: 400 }),
      request,
      platform.env
    );
  }

  try {
    const registered = await registerDynamicClient(platform.env.DB, platform.env, body);
    await recordAuditEvent(platform.env.DB, {
      actor: locals.user ? 'admin' : 'system',
      action: 'oauth.client.registered',
      target: registered.client_id,
      requestId: locals.requestId,
      metadata: {
        client_name: registered.client_name,
        redirect_uris: registered.redirect_uris
      }
    });
    return withPublicOauthCors(json(registered, { status: 201 }), request, platform.env);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Client registration failed.';
    return withPublicOauthCors(json(asOAuthError(message), { status: 400 }), request, platform.env);
  }
};
