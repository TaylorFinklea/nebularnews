import { json } from '@sveltejs/kit';
import { generateApiKey, listApiKeys } from '$lib/server/api-keys';

export const GET = async ({ platform }) => {
  const keys = await listApiKeys(platform.env.DB);
  return json({ keys });
};

export const POST = async ({ request, platform }) => {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const name = typeof body?.name === 'string' ? body.name.trim() : undefined;

  const result = await generateApiKey(platform.env.DB, platform.env, name);
  return json(result);
};
