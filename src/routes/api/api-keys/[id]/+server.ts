import { json } from '@sveltejs/kit';
import { revokeApiKey } from '$lib/server/api-keys';

export const DELETE = async ({ params, platform, locals }) => {
  const revoked = await revokeApiKey(locals.db, params.id);
  if (!revoked) {
    return json({ error: 'API key not found or already revoked' }, { status: 404 });
  }
  return json({ ok: true });
};
