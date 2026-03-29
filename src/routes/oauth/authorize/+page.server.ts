import { error, redirect } from '@sveltejs/kit';
import { recordAuditEvent } from '$lib/server/audit';
import {
  approveAuthorizeRequest,
  buildAuthorizeCardDescription,
  buildAuthorizeCardTitle,
  buildAuthorizeCardWarning,
  buildLoginRedirectForAuthorize,
  buildOAuthErrorRedirect,
  parseAuthorizeRequest,
  shouldAutoApproveConsent
} from '$lib/server/oauth/authorize';
import { assertPublicOauthRequest } from '$lib/server/oauth/http';

export const load = async ({ url, locals }) => {
  assertPublicOauthRequest(url, locals.env);

  const { client, request } = await parseAuthorizeRequest(url, locals.db, locals.env);
  if (!locals.user) {
    throw redirect(303, buildLoginRedirectForAuthorize(url));
  }

  if (await shouldAutoApproveConsent(locals.db, request, locals.user.id)) {
    const destination = await approveAuthorizeRequest(locals.db, locals.env, request, locals.user.id);
    throw redirect(303, destination);
  }

  return {
    client: {
      id: client.clientId,
      name: client.clientName,
      redirectOrigin: new URL(request.redirectUri).origin,
      redirectUri: request.redirectUri
    },
    authorization: request,
    title: buildAuthorizeCardTitle(request.audience),
    description: buildAuthorizeCardDescription(request.audience, client.clientName),
    warning: buildAuthorizeCardWarning(request.audience)
  };
};

export const actions = {
  default: async ({ request, url, locals }) => {
    assertPublicOauthRequest(url, locals.env);

    if (!locals.user) {
      throw redirect(303, buildLoginRedirectForAuthorize(url));
    }

    const formData = await request.formData();
    const params = new URLSearchParams();
    for (const key of [
      'client_id',
      'redirect_uri',
      'response_type',
      'scope',
      'state',
      'resource',
      'code_challenge',
      'code_challenge_method',
      'prompt'
    ]) {
      const value = formData.get(key);
      if (typeof value === 'string' && value.trim()) {
        params.set(key, value.trim());
      }
    }

    const authorizeUrl = new URL(url);
    authorizeUrl.search = params.toString();
    const { request: authorizeRequest } = await parseAuthorizeRequest(authorizeUrl, locals.db, locals.env);
    const decision = String(formData.get('decision') ?? '').trim().toLowerCase();
    if (!decision) {
      throw error(400, 'OAuth consent decision is required.');
    }

    if (decision === 'deny') {
      await recordAuditEvent(locals.db, {
        actor: 'admin',
        action: 'oauth.authorize.denied',
        target: authorizeRequest.clientId,
        requestId: locals.requestId
      });
      throw redirect(
        303,
        buildOAuthErrorRedirect(
          locals.env,
          authorizeRequest.redirectUri,
          'access_denied',
          authorizeRequest.state,
          'Access denied.',
          authorizeRequest.audience
        )
      );
    }

    if (decision !== 'allow') {
      throw error(400, 'OAuth consent decision is invalid.');
    }

    const destination = await approveAuthorizeRequest(locals.db, locals.env, authorizeRequest, locals.user.id);
    await recordAuditEvent(locals.db, {
      actor: 'admin',
      action: 'oauth.authorize.approved',
      target: authorizeRequest.clientId,
      requestId: locals.requestId,
      metadata: {
        scope: authorizeRequest.scope
      }
    });
    throw redirect(303, destination);
  }
};
