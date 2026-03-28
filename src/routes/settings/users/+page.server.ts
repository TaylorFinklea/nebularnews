import { requireAdmin } from '$lib/server/auth';
import { dbAll } from '$lib/server/db';

export const load = async ({ platform, locals }) => {
  requireAdmin(locals.user);

  const users = await dbAll<{
    id: string;
    email: string | null;
    display_name: string | null;
    auth_provider: string;
    role: string;
    created_at: number;
    last_login_at: number | null;
  }>(
    locals.db,
    `SELECT id, email, display_name, auth_provider, role, created_at, last_login_at
     FROM users
     ORDER BY created_at ASC`
  );

  return { users, currentUserId: locals.user?.id };
};
