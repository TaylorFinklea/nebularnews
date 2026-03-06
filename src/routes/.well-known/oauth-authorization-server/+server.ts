import { json } from '@sveltejs/kit';
import { buildAuthorizationServerMetadata } from '$lib/server/oauth/metadata';
import { assertPublicOauthRequest, withAudienceOauthCors } from '$lib/server/oauth/http';

export const OPTIONS = async ({ request, platform }) =>
  withAudienceOauthCors(new Response(null, { status: 204 }), request, platform.env, null);

export const GET = async ({ request, platform }) => {
  const audience = assertPublicOauthRequest(new URL(request.url), platform.env);
  return withAudienceOauthCors(json(buildAuthorizationServerMetadata(platform.env, audience)), request, platform.env, audience);
};
