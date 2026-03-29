import { json } from '@sveltejs/kit';
import { buildProtectedResourceMetadata } from '$lib/server/oauth/metadata';
import { assertPublicOauthRequest, withAudienceOauthCors } from '$lib/server/oauth/http';

export const OPTIONS = async ({ request, locals }) =>
  withAudienceOauthCors(new Response(null, { status: 204 }), request, locals.env, null);

export const GET = async ({ request, locals }) => {
  const audience = assertPublicOauthRequest(new URL(request.url), locals.env);
  return withAudienceOauthCors(json(buildProtectedResourceMetadata(locals.env, audience)), request, locals.env, audience);
};
