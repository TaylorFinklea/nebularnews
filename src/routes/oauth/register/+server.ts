import { json } from '@sveltejs/kit';
import { registerDynamicClient } from '$lib/server/oauth/register';
import { assertPublicMcpRequest, withPublicOauthCors } from '$lib/server/oauth/http';
import { recordAuditEvent } from '$lib/server/audit';

const asOAuthError = (message: string) => ({
  error: 'invalid_client_metadata',
  error_description: message
});

export const OPTIONS = async ({ request, locals }) =>
  withPublicOauthCors(new Response(null, { status: 204 }), request, locals.env);

export const POST = async ({ request, locals }) => {
  assertPublicMcpRequest(new URL(request.url), locals.env);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return withPublicOauthCors(
      json(asOAuthError('Request body must be valid JSON.'), { status: 400 }),
      request,
      locals.env
    );
  }

  try {
    const registered = await registerDynamicClient(locals.db, locals.env, body);
    await recordAuditEvent(locals.db, {
      actor: locals.user ? 'admin' : 'system',
      action: 'oauth.client.registered',
      target: registered.client_id,
      requestId: locals.requestId,
      metadata: {
        client_name: registered.client_name,
        redirect_uris: registered.redirect_uris
      }
    });
    return withPublicOauthCors(json(registered, { status: 201 }), request, locals.env);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Client registration failed.';
    return withPublicOauthCors(json(asOAuthError(message), { status: 400 }), request, locals.env);
  }
};
