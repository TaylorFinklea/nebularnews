import { json } from '@sveltejs/kit';
import { buildProtectedResourceMetadata } from '$lib/server/oauth/metadata';
import { assertPublicMcpRequest, withAudienceOauthCors } from '$lib/server/oauth/http';

export const OPTIONS = async ({ request, platform }) =>
  withAudienceOauthCors(new Response(null, { status: 204 }), request, platform.env, 'mcp');

export const GET = async ({ request, platform }) => {
  assertPublicMcpRequest(new URL(request.url), platform.env);
  return withAudienceOauthCors(json(buildProtectedResourceMetadata(platform.env, 'mcp')), request, platform.env, 'mcp');
};
