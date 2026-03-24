import { error } from '@sveltejs/kit';
import { authenticatePublicAccessToken } from '$lib/server/oauth/tokens';
import { hasMobileScope, type MOBILE_SUPPORTED_SCOPES } from './context';
import { ensureSchema } from '$lib/server/migrations';
import { getUserById, type AuthUser } from '$lib/server/auth';

export const requireMobileAccess = async (
  request: Request,
  env: App.Platform['env'],
  db: D1Database,
  requiredScope: (typeof MOBILE_SUPPORTED_SCOPES)[number] = 'app:read'
) => {
  await ensureSchema(db);

  const authorization = request.headers.get('authorization')?.trim() ?? '';
  const rawToken = authorization.toLowerCase().startsWith('bearer ') ? authorization.slice(7).trim() : null;
  if (!rawToken) {
    throw error(401, 'Missing OAuth access token.');
  }

  const token = await authenticatePublicAccessToken(db, env, 'mobile', rawToken);
  if (!token) {
    throw error(401, 'Invalid OAuth access token.');
  }
  if (!hasMobileScope(token.scope, requiredScope)) {
    throw error(403, 'Insufficient OAuth scope.');
  }

  const user = await getUserById(db, token.user_id);
  if (!user) {
    // Fallback for tokens created before users table — assume admin
    const fallbackUser: AuthUser = { id: token.user_id, role: token.user_id === 'admin' ? 'admin' : 'member' };
    return { token, user: fallbackUser };
  }

  return { token, user };
};
