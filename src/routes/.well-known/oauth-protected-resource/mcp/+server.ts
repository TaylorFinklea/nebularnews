import { json } from '@sveltejs/kit';
import { buildProtectedResourceMetadata } from '$lib/server/oauth/metadata';
import { assertPublicMcpRequest, withAudienceOauthCors } from '$lib/server/oauth/http';

export const OPTIONS = async ({ request, locals }) =>
  withAudienceOauthCors(new Response(null, { status: 204 }), request, locals.env, 'mcp');

export const GET = async ({ request, locals }) => {
  assertPublicMcpRequest(new URL(request.url), locals.env);
  return withAudienceOauthCors(json(buildProtectedResourceMetadata(locals.env, 'mcp')), request, locals.env, 'mcp');
};
