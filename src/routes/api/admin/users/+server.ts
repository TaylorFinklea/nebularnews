import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth';
import { dbAll } from '$lib/server/db';

export const GET = async ({ platform, locals }) => {
  requireAdmin(locals.user);

  const users = await dbAll<{
    id: string;
    email: string | null;
    display_name: string | null;
    auth_provider: string;
    role: string;
    created_at: number;
    updated_at: number;
    last_login_at: number | null;
  }>(
    locals.db,
    `SELECT id, email, display_name, auth_provider, role, created_at, updated_at, last_login_at
     FROM users
     ORDER BY created_at DESC`
  );

  return json({ users });
};
