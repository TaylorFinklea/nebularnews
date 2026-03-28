import { json } from '@sveltejs/kit';
import { requireMobileAccess } from '$lib/server/mobile/auth';
import { getTagById, deleteTag } from '$lib/server/tags';

export const DELETE = async ({ params, request, platform, locals }) => {
  const { user } = await requireMobileAccess(request, platform.env, locals.db, 'app:write');
  void user;
  const tag = await getTagById(locals.db, params.id);
  if (!tag) return json({ error: 'Tag not found' }, { status: 404 });
  await deleteTag(locals.db, params.id);
  return json({ ok: true });
};
