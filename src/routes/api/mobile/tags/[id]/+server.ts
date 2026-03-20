import { json } from '@sveltejs/kit';
import { requireMobileAccess } from '$lib/server/mobile/auth';
import { getTagById, deleteTag } from '$lib/server/tags';

export const DELETE = async ({ params, request, platform }) => {
  await requireMobileAccess(request, platform.env, platform.env.DB, 'app:write');
  const tag = await getTagById(platform.env.DB, params.id);
  if (!tag) return json({ error: 'Tag not found' }, { status: 404 });
  await deleteTag(platform.env.DB, params.id);
  return json({ ok: true });
};
