import { json } from '@sveltejs/kit';
import { buildProtectedResourceMetadata } from '$lib/server/oauth/metadata';
import { assertPublicMcpRequest, withPublicOauthCors } from '$lib/server/oauth/http';

export const OPTIONS = async ({ request, platform }) =>
  withPublicOauthCors(new Response(null, { status: 204 }), request, platform.env);

export const GET = async ({ request, platform }) => {
  assertPublicMcpRequest(new URL(request.url), platform.env);
  return withPublicOauthCors(json(buildProtectedResourceMetadata(platform.env)), request, platform.env);
};
