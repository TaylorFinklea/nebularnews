import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth';
import { dbGet, dbRun, now } from '$lib/server/db';

export const GET = async ({ params, platform, locals }) => {
  requireAdmin(locals.user);
  const user = await dbGet<{
    id: string;
    email: string | null;
    display_name: string | null;
    auth_provider: string;
    role: string;
    created_at: number;
    updated_at: number;
    last_login_at: number | null;
  }>(locals.db, 'SELECT * FROM users WHERE id = ?', [params.id]);

  if (!user) return json({ error: 'User not found' }, { status: 404 });
  return json({ user });
};

export const PATCH = async ({ params, request, platform, locals }) => {
  requireAdmin(locals.user);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  // Prevent self-demotion
  if (params.id === locals.user?.id && body?.role === 'member') {
    return json({ error: 'Cannot demote yourself' }, { status: 400 });
  }

  const updates: string[] = [];
  const values: unknown[] = [];

  if (typeof body?.role === 'string' && ['admin', 'member'].includes(body.role)) {
    updates.push('role = ?');
    values.push(body.role);
  }
  if (typeof body?.display_name === 'string') {
    updates.push('display_name = ?');
    values.push(body.display_name.trim());
  }

  if (updates.length === 0) {
    return json({ error: 'No valid fields to update' }, { status: 400 });
  }

  updates.push('updated_at = ?');
  values.push(now());
  values.push(params.id);

  await dbRun(
    locals.db,
    `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
    values
  );

  const user = await dbGet(locals.db, 'SELECT * FROM users WHERE id = ?', [params.id]);
  return json({ user });
};

export const DELETE = async ({ params, platform, locals }) => {
  requireAdmin(locals.user);

  // Prevent self-deletion
  if (params.id === locals.user?.id) {
    return json({ error: 'Cannot delete yourself' }, { status: 400 });
  }

  // Prevent deleting the bootstrap admin
  if (params.id === 'admin') {
    return json({ error: 'Cannot delete the system admin account' }, { status: 400 });
  }

  // Delete user — CASCADE will clean up subscriptions, read state, reactions, etc.
  await dbRun(locals.db, 'DELETE FROM users WHERE id = ?', [params.id]);
  return json({ ok: true });
};
