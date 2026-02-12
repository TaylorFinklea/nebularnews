import { json } from '@sveltejs/kit';
import { deleteProviderKey } from '$lib/server/settings';

export const DELETE = async ({ params, platform }) => {
  const provider = params.provider;
  if (!['openai', 'anthropic'].includes(provider)) return json({ error: 'Invalid provider' }, { status: 400 });
  await deleteProviderKey(platform.env.DB, provider as 'openai' | 'anthropic');
  return json({ ok: true });
};
