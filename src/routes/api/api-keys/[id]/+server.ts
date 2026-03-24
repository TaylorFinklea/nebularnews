import { json } from '@sveltejs/kit';
import { revokeApiKey } from '$lib/server/api-keys';

export const DELETE = async ({ params, platform }) => {
  const revoked = await revokeApiKey(platform.env.DB, params.id);
  if (!revoked) {
    return json({ error: 'API key not found or already revoked' }, { status: 404 });
  }
  return json({ ok: true });
};
