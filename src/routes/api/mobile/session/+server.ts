import { json } from '@sveltejs/kit';
import { requireMobileAccess } from '$lib/server/mobile/auth';
import { getConfiguredPublicMobileOrigin, getPublicMobileResource } from '$lib/server/mobile/context';

export const GET = async ({ request, platform }) => {
  const token = await requireMobileAccess(request, platform.env, platform.env.DB, 'app:read');

  return json({
    session: {
      authenticated: true,
      clientId: token.client_id,
      userId: token.user_id,
      scope: token.scope,
      scopes: token.scope.split(/\s+/).filter(Boolean)
    },
    server: {
      origin: getConfiguredPublicMobileOrigin(platform.env),
      resource: getPublicMobileResource(platform.env)
    },
    features: {
      dashboard: true,
      newsBrief: true,
      reactions: true,
      tags: true
    }
  });
};
